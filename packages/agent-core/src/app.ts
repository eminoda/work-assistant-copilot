import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { ToolRegistry, type AgentEvent } from '@workcopilot/tool-registry'
import { WorkflowEngine, workflowSchema, canLinkPrerequisite, type ExecutionResult, type Workflow } from '@workcopilot/workflow-engine'
import { recordingSchema, recordingToWorkflow, sortRecordingEvents, lastRecordedUrl, sessionCredentialKeyForUrl } from '@workcopilot/browser-recorder'
import { registerBrowserTools, PlaywrightRuntime, shouldSkipNavigation } from '@workcopilot/playwright-runtime'
import { LocalCredentialProvider, getOrCreateLocalToken } from '@workcopilot/credential-provider'
import { gitSnapshotSchema, scanGitRepository } from '@workcopilot/git-analyzer'
import { fallbackSummary, rawMemoryFromGit } from '@workcopilot/memory-engine'
import { createLanguageModel, ModelProvider, modelConfigSchema } from '@workcopilot/model-provider'
import { registerExportTools } from '@workcopilot/feishu-adapter'
import { NameConflictError, WorkCopilotStore } from './store.js'

export type AppServices = {
  store: WorkCopilotStore
  registry: ToolRegistry
  engine: WorkflowEngine
  credentials: LocalCredentialProvider
  browser: PlaywrightRuntime
  token: string
  events: EventBus
}

export class EventBus {
  #subscribers = new Set<(event: AgentEvent) => void>()
  publish(event: AgentEvent) { for (const subscriber of this.#subscribers) subscriber(event) }
  subscribe(subscriber: (event: AgentEvent) => void) { this.#subscribers.add(subscriber); return () => this.#subscribers.delete(subscriber) }
}

export async function createServices(store = new WorkCopilotStore()): Promise<AppServices> {
  const credentials = new LocalCredentialProvider()
  const token = await getOrCreateLocalToken(credentials)
  const registry = new ToolRegistry()
  const browser = registerBrowserTools(registry, new PlaywrightRuntime(), {
    resolveCredential: (key) => credentials.get(key),
  })
  registerExportTools(registry)
  registry.register({
    name: 'credential.get', description: 'Resolve a local credential into the execution context',
    inputSchema: z.object({ key: z.string() }), outputSchema: z.object({ found: z.boolean() }),
    execute: async ({ key }, context) => {
      const value = await credentials.get(key)
      if (value) context.values.set(`credential:${key}`, value)
      return { found: Boolean(value) }
    },
  })
  registry.register({
    name: 'credential.save',
    description: 'Save a secret in the local credential provider',
    inputSchema: z.object({ key: z.string(), value: z.string().min(1) }),
    outputSchema: z.object({ saved: z.boolean() }),
    execute: async ({ key, value }) => { await credentials.save(key, value); return { saved: true } },
  })
  registry.register({
    name: 'credential.remove',
    description: 'Remove a local credential',
    inputSchema: z.object({ key: z.string() }),
    outputSchema: z.object({ removed: z.boolean() }),
    execute: async ({ key }) => { await credentials.remove(key); return { removed: true } },
  })
  registry.register({
    name: 'git.scan',
    description: 'Collect factual Git status and diff data from a workspace',
    inputSchema: z.object({ path: z.string().min(1) }),
    outputSchema: z.object({ snapshot: z.unknown() }),
    execute: async ({ path }) => ({ snapshot: await scanGitRepository(path) }),
  })
  registry.register({
    name: 'memory.query',
    description: 'Query local work memories by date range',
    inputSchema: z.object({ from: z.string().optional(), to: z.string().optional() }),
    outputSchema: z.object({ records: z.array(z.unknown()) }),
    execute: async ({ from, to }) => ({ records: await store.listMemories(from, to) }),
  })
  registry.register({
    name: 'summary.generate',
    description: 'Generate a deterministic fallback summary from work memories',
    inputSchema: z.object({ title: z.string(), records: z.array(z.unknown()) }),
    outputSchema: z.object({ content: z.string() }),
    execute: async ({ title, records }) => ({ content: fallbackSummary(records as never, title) }),
  })
  const workspaceRoot = resolve(process.env.WORKCOPILOT_WORKSPACE || process.cwd())
  const safePath = (input: string) => {
    const target = resolve(workspaceRoot, input)
    if (relative(workspaceRoot, target).startsWith('..')) throw new Error('Path is outside the configured workspace')
    if (/\\.(env|pem|key|secret)$/i.test(target)) throw new Error('Sensitive file access denied')
    return target
  }
  registry.register({
    name: 'file.read',
    description: 'Read a UTF-8 file inside the configured workspace',
    inputSchema: z.object({ path: z.string() }),
    outputSchema: z.object({ content: z.string() }),
    execute: async ({ path }) => ({ content: await readFile(safePath(path), 'utf8') }),
  })
  registry.register({
    name: 'file.write',
    description: 'Write a UTF-8 file inside the configured workspace',
    inputSchema: z.object({ path: z.string(), content: z.string().max(1_000_000) }),
    outputSchema: z.object({ written: z.boolean() }),
    execute: async ({ path, content }) => { await writeFile(safePath(path), content, 'utf8'); return { written: true } },
  })
  const events = new EventBus()
  return { store, registry, engine: new WorkflowEngine(registry), credentials, browser, token, events }
}

/** After a successful login run, refresh workflow session cookies from the live browser. */
async function persistLoginSessionFromBrowser(input: {
  services: AppServices
  workflowId: string
  homeUrl: string
  executionId: string
}) {
  const { services, workflowId, homeUrl, executionId } = input
  try {
    const page = await services.browser.page()
    const origin = `${new URL(homeUrl).origin}/`
    const cookies = await page.context().cookies(origin)
    if (!cookies.length) {
      console.warn(`[execute] ${executionId} no browser cookies to persist for ${origin}`)
      return
    }
    const payload = cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path || '/',
      ...(cookie.expires >= 0 ? { expires: cookie.expires } : {}),
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      ...(cookie.sameSite && cookie.sameSite !== 'None'
        ? { sameSite: cookie.sameSite }
        : cookie.sameSite === 'None'
          ? { sameSite: 'None' as const }
          : {}),
    }))
    const workflowKey = `workflow.${workflowId}.session`
    const hostKey = sessionCredentialKeyForUrl(homeUrl)
    const raw = JSON.stringify(payload)
    await services.credentials.save(workflowKey, raw)
    await services.credentials.save(hostKey, raw)
    console.log(
      `[execute] ${executionId} persisted session cookies key=${workflowKey} names=${payload.map((cookie) => cookie.name).join(',')}`,
    )
  } catch (error) {
    console.warn(`[execute] ${executionId} persist session cookies failed`, error)
  }
}

function cancelledResult(executionId: string, startedAt: string, events: AgentEvent[], error = 'Execution cancelled'): ExecutionResult {
  const finishedAt = new Date().toISOString()
  events.push({
    type: 'workflow.failed',
    executionId,
    message: error,
    timestamp: finishedAt,
  })
  return {
    id: executionId,
    status: 'CANCELLED',
    startedAt,
    finishedAt,
    outputs: {},
    error,
    events,
  }
}

function extractOutputText(output: unknown): string {
  if (typeof output === 'string') return output.trim()
  if (output && typeof output === 'object' && 'value' in output) {
    const value = (output as { value: unknown }).value
    if (value == null) return ''
    return String(value).trim()
  }
  return ''
}

async function hasLoginPrerequisite(
  services: AppServices,
  workflow: Workflow & { id: string },
): Promise<boolean> {
  let cursorId = workflow.prerequisiteWorkflowId
  const seen = new Set<string>()
  while (cursorId) {
    if (seen.has(cursorId)) break
    seen.add(cursorId)
    const prerequisite = await services.store.getWorkflow(cursorId)
    if (!prerequisite) break
    if (prerequisite.kind === 'login') return true
    cursorId = prerequisite.prerequisiteWorkflowId
  }
  return false
}

function withoutCookieSteps(workflow: Workflow & { id: string }): Workflow & { id: string } {
  const steps = workflow.steps.filter((step) => step.tool !== 'browser.setCookies')
  if (steps.length === workflow.steps.length) return workflow
  return {
    ...workflow,
    steps: steps.map((step, index) => ({ ...step, id: `step-${index + 1}` })),
  }
}

async function persistExtractMessages(input: {
  services: AppServices
  workflow: Workflow & { id: string }
  result: ExecutionResult
}) {
  const { services, workflow, result } = input
  if (result.status !== 'SUCCESS') return
  for (const step of workflow.steps) {
    if (step.tool !== 'browser.extract' || !step.saveAs?.startsWith('extract:')) continue
    const label = step.saveAs.slice('extract:'.length).trim()
    if (!label) continue
    const value = extractOutputText(result.outputs[step.saveAs])
    if (!value) continue
    try {
      const saved = await services.store.upsertExtractMessage({
        workflowId: workflow.id,
        title: workflow.name,
        label,
        value,
      })
      console.log(
        `[notify] ${result.id} message ${saved.created ? 'created' : 'updated'} label=${label} changed=${saved.changed}`,
      )
    } catch (error) {
      console.warn(`[notify] ${result.id} persist extract failed`, error)
    }
  }
}

/** Login workflows: inject session cookies on homeUrl; if no redirect, skip full steps. */
async function tryLoginSessionReuse(input: {
  workflow: Workflow & { id: string }
  services: AppServices
  executionId: string
  onEvent: (event: AgentEvent) => void
  signal?: AbortSignal
}): Promise<ExecutionResult | null> {
  const { workflow, services, executionId, onEvent, signal } = input
  const homeUrl = workflow.homeUrl
  if (!homeUrl) return null

  // Prefer workflow-bound login-diff cookies; fall back to host session.
  const keys = [
    `workflow.${workflow.id}.session`,
    sessionCredentialKeyForUrl(homeUrl),
  ]

  const startedAt = new Date().toISOString()
  const events: AgentEvent[] = []
  const emit = (event: AgentEvent) => {
    events.push(event)
    onEvent(event)
  }
  emit({
    type: 'workflow.started',
    executionId,
    message: `${workflow.name} (session reuse)`,
    timestamp: startedAt,
  })

  try {
    if (signal?.aborted) return cancelledResult(executionId, startedAt, events)

    const values = new Map<string, unknown>()
    const context = { executionId, emit, values, ...(signal ? { signal } : {}) }
    let sessionKey: string | undefined
    let raw: string | undefined
    for (const key of keys) {
      raw = await services.credentials.get(key)
      if (raw) {
        sessionKey = key
        break
      }
    }
    if (!sessionKey || !raw) {
      console.log(`[execute] ${executionId} session reuse skipped — no session credential`)
      return null
    }

    let cookieNames: string[] = []
    try {
      const parsed = JSON.parse(raw) as Array<{ name?: string }>
      cookieNames = parsed.map((cookie) => cookie.name).filter((name): name is string => Boolean(name))
    } catch {
      // keep empty
    }
    console.log(
      `[execute] ${executionId} session pretest key=${sessionKey} cookies=${cookieNames.join(',') || '(none)'} home=${homeUrl}`,
    )

    values.set(`credential:${sessionKey}`, raw)
    await services.registry.execute('browser.setCookies', { credentialKey: sessionKey, url: homeUrl }, context)
    if (signal?.aborted) return cancelledResult(executionId, startedAt, events)
    await services.registry.execute('browser.open', { url: homeUrl }, context)
    if (signal?.aborted) return cancelledResult(executionId, startedAt, events)
    const page = await services.browser.page()
    const current = page.url()
    const stayed = shouldSkipNavigation(current, homeUrl)

    if (!stayed) {
      emit({
        type: 'tool.progress',
        executionId,
        tool: 'browser.open',
        message: `session redirected to ${current} — fall back to full workflow`,
        timestamp: new Date().toISOString(),
      })
      return null
    }

    const finishedAt = new Date().toISOString()
    emit({
      type: 'workflow.finished',
      executionId,
      message: 'session reused — skip full workflow',
      timestamp: finishedAt,
    })
    return {
      id: executionId,
      status: 'SUCCESS',
      startedAt,
      finishedAt,
      outputs: { sessionReused: true, url: current, sessionKey },
      events,
    }
  } catch (error) {
    if (signal?.aborted) {
      console.log(`[execute] ${executionId} session reuse cancelled`)
      return cancelledResult(executionId, startedAt, events)
    }
    console.warn('[execute] session reuse failed', error)
    return null
  }
}

export function createApp(services: AppServices) {
  const app = new Hono()
  app.use('*', cors({
    origin: (origin) => origin.startsWith('chrome-extension://') || origin.startsWith('http://localhost') || origin.startsWith('tauri://') ? origin : '',
    allowHeaders: ['authorization', 'content-type'],
  }))
  app.get('/api/health', (c) => c.json({ status: 'ok', version: '0.1.0' }))
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next()
    if (c.req.header('authorization') !== `Bearer ${services.token}`) return c.json({ error: 'Unauthorized' }, 401)
    return next()
  })

  app.get('/api/workflows', async (c) => c.json(await services.store.listWorkflows()))
  app.get('/api/workflows/:id', async (c) => {
    const workflow = await services.store.getWorkflow(c.req.param('id'))
    if (!workflow) return c.json({ error: 'Workflow not found' }, 404)
    return c.json(workflow)
  })
  app.post('/api/workflows', async (c) => {
    const workflow = workflowSchema.parse(await c.req.json())
    return c.json(await services.store.saveWorkflow(workflow), 201)
  })
  app.delete('/api/workflows/:id', async (c) => { await services.store.deleteWorkflow(c.req.param('id')); return c.body(null, 204) })
  app.put('/api/workflows/:id/name', async (c) => {
    const body = z.object({ name: z.string().min(1) }).parse(await c.req.json())
    try {
      const updated = await services.store.renameWorkflow(c.req.param('id'), body.name)
      if (!updated) return c.json({ error: 'Workflow not found' }, 404)
      return c.json({ workflow: updated })
    } catch (error) {
      if (error instanceof NameConflictError) return c.json({ error: error.message }, 409)
      return c.json({ error: error instanceof Error ? error.message : '重命名失败' }, 400)
    }
  })
  app.put('/api/workflows/:id/prerequisite', async (c) => {
    const body = z.object({
      prerequisiteWorkflowId: z.string().min(1).nullable(),
    }).parse(await c.req.json())
    const workflow = await services.store.getWorkflow(c.req.param('id'))
    if (!workflow) return c.json({ error: 'Workflow not found' }, 404)
    if (body.prerequisiteWorkflowId) {
      const prerequisite = await services.store.getWorkflow(body.prerequisiteWorkflowId)
      if (!prerequisite) return c.json({ error: '前置工作流不存在' }, 404)
      if (!canLinkPrerequisite(prerequisite, workflow)) {
        return c.json({ error: '路径不匹配：前置工作流末路径需与当前工作流首路径相同' }, 400)
      }
    }
    try {
      let updated = await services.store.setPrerequisiteWorkflowId(
        c.req.param('id'),
        body.prerequisiteWorkflowId,
      )
      if (!updated) return c.json({ error: 'Workflow not found' }, 404)
      // Linking a login prerequisite: drop cookie injection from the current workflow.
      if (body.prerequisiteWorkflowId) {
        const prerequisite = await services.store.getWorkflow(body.prerequisiteWorkflowId)
        if (prerequisite?.kind === 'login' && updated.steps.some((step) => step.tool === 'browser.setCookies')) {
          const cleaned = withoutCookieSteps(updated)
          await services.store.db.workflow.update({
            where: { id: updated.id },
            data: {
              steps: {
                kind: cleaned.kind,
                ...(cleaned.homeUrl ? { homeUrl: cleaned.homeUrl } : {}),
                ...(cleaned.prerequisiteWorkflowId
                  ? { prerequisiteWorkflowId: cleaned.prerequisiteWorkflowId }
                  : {}),
                steps: cleaned.steps,
              } as never,
            },
          })
          updated = cleaned
          console.log(`[workflow] ${updated.id} stripped cookie steps after linking login prerequisite`)
        }
      }
      return c.json({ workflow: updated })
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : '更新失败' }, 400)
    }
  })
  app.post('/api/recordings', async (c) => {
    const recording = recordingSchema.parse(await c.req.json())
    await services.store.assertWorkflowNameAvailable(recording.name)
    let events = sortRecordingEvents(recording.events)

    let skipCookieInjection = false
    if (recording.prerequisiteWorkflowId) {
      const prerequisite = await services.store.getWorkflow(recording.prerequisiteWorkflowId)
      skipCookieInjection = prerequisite?.kind === 'login'
    }

    // Persist cookie snapshots as credentials (same model as passwords) for later injection.
    // App workflows with a login prerequisite skip cookie ownership — login flow owns the session.
    events = await Promise.all(events.map(async (event) => {
      if (event.type !== 'cookies' || !event.cookies?.length) return event
      if (skipCookieInjection) {
        const { cookies: _omit, cookieCredentialKey: _key, ...rest } = event
        return rest
      }
      const key = event.cookieCredentialKey || sessionCredentialKeyForUrl(event.url)
      await services.credentials.save(key, JSON.stringify(event.cookies))
      const { cookies: _omit, ...rest } = event
      return { ...rest, cookieCredentialKey: key }
    }))

    const homeUrl = lastRecordedUrl(events)
    await services.store.saveRecording({
      name: recording.name,
      intent: recording.intent,
      events,
      ...(homeUrl ? { url: homeUrl } : {}),
    })
    let workflow = await services.store.saveWorkflow(recordingToWorkflow({ ...recording, events }))

    if (skipCookieInjection && workflow.steps.some((step) => step.tool === 'browser.setCookies')) {
      const cleaned = withoutCookieSteps(workflow)
      await services.store.db.workflow.update({
        where: { id: workflow.id },
        data: { steps: {
          kind: cleaned.kind,
          ...(cleaned.homeUrl ? { homeUrl: cleaned.homeUrl } : {}),
          ...(cleaned.prerequisiteWorkflowId
            ? { prerequisiteWorkflowId: cleaned.prerequisiteWorkflowId }
            : {}),
          steps: cleaned.steps,
        } as never },
      })
      workflow = cleaned
      console.log(`[recordings] ${workflow.id} skip cookie steps — login prerequisite owns session`)
    }

    // Bind session cookie credential to this workflow id for clearer ownership.
    if (!skipCookieInjection && workflow.id && homeUrl) {
      const hostKey = sessionCredentialKeyForUrl(homeUrl)
      const raw = await services.credentials.get(hostKey)
      if (raw) {
        const workflowKey = `workflow.${workflow.id}.session`
        await services.credentials.save(workflowKey, raw)
        const rebound = {
          ...workflow,
          steps: workflow.steps.map((step) => {
            if (step.tool !== 'browser.setCookies') return step
            const key = step.params.credentialKey
            if (key !== hostKey) return step
            return { ...step, params: { ...step.params, credentialKey: workflowKey, url: homeUrl } }
          }),
        }
        // Update packed steps in DB by delete+recreate is heavy; patch via prisma update.
        await services.store.db.workflow.update({
          where: { id: workflow.id },
          data: {
            steps: {
              kind: rebound.kind,
              ...(rebound.homeUrl ? { homeUrl: rebound.homeUrl } : {}),
              ...(rebound.prerequisiteWorkflowId
                ? { prerequisiteWorkflowId: rebound.prerequisiteWorkflowId }
                : {}),
              steps: rebound.steps,
            } as never,
          },
        })
        return c.json({ workflow: { ...rebound, id: workflow.id } }, 201)
      }
    }

    return c.json({ workflow }, 201)
  })

  const active = new Map<string, Promise<ExecutionResult>>()
  const controllers = new Map<string, AbortController>()
  const phases = new Map<string, 'workflow' | 'browser'>()

  app.post('/api/workflows/:id/execute', async (c) => {
    const workflow = await services.store.getWorkflow(c.req.param('id'))
    if (!workflow) return c.json({ error: 'Workflow not found' }, 404)
    const requestId = randomUUID()
    const controller = new AbortController()
    controllers.set(requestId, controller)
    phases.set(requestId, 'workflow')
    console.log(`[execute] queued ${requestId} workflow=${workflow.id} name=${workflow.name} kind=${workflow.kind}`)

    const run = async (): Promise<ExecutionResult> => {
      const onEvent = (event: AgentEvent) => {
        const detail = [event.tool, event.message].filter(Boolean).join(' ')
        console.log(`[execute] ${requestId} ${event.type}${detail ? ` ${detail}` : ''}`)
        services.events.publish(event)
      }

      let resolveBrowserClosed = () => {}
      const browserClosed = new Promise<void>((resolve) => {
        resolveBrowserClosed = resolve
      })

      services.browser.setRelaunchOnClose(false)
      services.browser.setDisconnectHandler(() => {
        const phase = phases.get(requestId) ?? 'workflow'
        if (phase === 'workflow' && !controller.signal.aborted) {
          console.log(`[execute] ${requestId} browser disconnected — cancelling workflow`)
          controller.abort()
        } else {
          console.log(`[execute] ${requestId} browser disconnected — ending session hold`)
        }
        resolveBrowserClosed()
      })

      const holdUntilBrowserCloses = async (
        result: ExecutionResult,
        target: Workflow & { id: string } = workflow,
      ): Promise<ExecutionResult> => {
        if (result.status === 'SUCCESS') {
          await persistExtractMessages({ services, workflow: target, result })
        }
        if (result.status === 'CANCELLED' || !services.browser.isSessionOpen()) return result
        phases.set(requestId, 'browser')
        console.log(`[execute] ${requestId} workflow ${result.status} — holding until browser closes`)
        await Promise.race([
          browserClosed,
          (async () => {
            while (services.browser.isSessionOpen()) {
              await new Promise((resolve) => setTimeout(resolve, 400))
            }
            resolveBrowserClosed()
          })(),
        ])
        return result
      }

      const runOneWorkflow = async (target: Workflow & { id: string }): Promise<ExecutionResult> => {
        const skipCookies = await hasLoginPrerequisite(services, target)
        const executable = skipCookies ? withoutCookieSteps(target) : target
        if (skipCookies && executable.steps.length !== target.steps.length) {
          console.log(`[execute] ${requestId} skip cookie injection for ${target.name} — login prerequisite owns session`)
        }

        if (executable.kind === 'login' && executable.homeUrl) {
          const reused = await tryLoginSessionReuse({
            workflow: executable,
            services,
            executionId: requestId,
            onEvent,
            signal: controller.signal,
          })
          if (controller.signal.aborted) {
            return cancelledResult(requestId, new Date().toISOString(), [])
          }
          if (reused) {
            if (reused.status === 'CANCELLED') return reused
            console.log(`[execute] ${requestId} login session reuse success — skip full workflow (${target.name})`)
            await persistLoginSessionFromBrowser({
              services,
              workflowId: target.id,
              homeUrl: executable.homeUrl,
              executionId: requestId,
            })
            return reused
          }
          console.log(`[execute] ${requestId} login session reuse missed — run full workflow (${target.name})`)
        }

        const result = await services.engine.execute(executable, onEvent, controller.signal, requestId)
        if (result.status !== 'SUCCESS' || executable.kind !== 'login' || !executable.homeUrl) return result
        try {
          const page = await services.browser.page()
          const current = page.url()
          if (/\/login(\/|$|\?|#)/i.test(current)) {
            const error = `登录流程结束仍在登录页：${current}（期望进入 ${executable.homeUrl}）`
            console.error(`[execute] ${requestId} ${error}`)
            return {
              ...result,
              status: 'FAILED' as const,
              error,
              events: [
                ...result.events,
                {
                  type: 'workflow.failed' as const,
                  executionId: requestId,
                  message: error,
                  timestamp: new Date().toISOString(),
                },
              ],
            }
          }
          await persistLoginSessionFromBrowser({
            services,
            workflowId: target.id,
            homeUrl: executable.homeUrl,
            executionId: requestId,
          })
        } catch (error) {
          if (controller.signal.aborted) {
            return { ...result, status: 'CANCELLED' as const, error: 'Execution cancelled' }
          }
          console.warn(`[execute] ${requestId} post-login URL check failed`, error)
        }
        return result
      }

      try {
        const chain: Array<Workflow & { id: string }> = []
        const seen = new Set<string>([workflow.id])
        let cursorId = workflow.prerequisiteWorkflowId
        while (cursorId) {
          if (seen.has(cursorId)) {
            return {
              id: requestId,
              status: 'FAILED',
              startedAt: new Date().toISOString(),
              finishedAt: new Date().toISOString(),
              outputs: {},
              error: '前置工作流存在循环引用',
              events: [],
            }
          }
          seen.add(cursorId)
          const prerequisite = await services.store.getWorkflow(cursorId)
          if (!prerequisite) break
          chain.unshift(prerequisite)
          cursorId = prerequisite.prerequisiteWorkflowId
        }

        for (const prerequisite of chain) {
          console.log(`[execute] ${requestId} prerequisite → ${prerequisite.name} (${prerequisite.id})`)
          const preResult = await runOneWorkflow(prerequisite)
          if (preResult.status === 'SUCCESS') {
            await persistExtractMessages({ services, workflow: prerequisite, result: preResult })
          } else {
            return holdUntilBrowserCloses(preResult, prerequisite)
          }
        }

        const result = await runOneWorkflow(workflow)
        return holdUntilBrowserCloses(result, workflow)
      } finally {
        services.browser.setDisconnectHandler(undefined)
        services.browser.setRelaunchOnClose(true)
      }
    }

    const promise = run().then(async (result) => {
      if (result.status === 'FAILED' || result.status === 'CANCELLED') {
        console.error(`[execute] ${requestId} ${result.status}: ${result.error ?? 'unknown error'}`)
      } else {
        console.log(`[execute] ${requestId} ${result.status}`)
      }
      await services.store.saveExecution(workflow.id, result)
      return result
    }).catch((error) => {
      console.error(`[execute] ${requestId} crashed`, error)
      throw error
    }).finally(() => {
      controllers.delete(requestId)
      phases.delete(requestId)
    })
    active.set(requestId, promise)
    void promise.finally(() => active.delete(requestId))
    return c.json({ executionId: requestId }, 202)
  })

  app.post('/api/executions/:id/cancel', async (c) => {
    const id = c.req.param('id')
    const controller = controllers.get(id)
    if (!controller && !active.has(id)) {
      return c.json({ error: 'Execution not found or already finished' }, 404)
    }
    console.log(`[execute] ${id} cancel requested`)
    controller?.abort()
    await services.browser.close()
    return c.json({ ok: true, status: 'CANCELLED' })
  })

  app.get('/api/executions/:id', async (c) => {
    const id = c.req.param('id')
    const pending = active.get(id)
    if (pending) {
      return c.json({
        id,
        status: 'RUNNING',
        phase: phases.get(id) ?? 'workflow',
      })
    }
    const execution = await services.store.getExecution(id)
    return execution ? c.json(execution) : c.json({ error: 'Execution not found' }, 404)
  })

  app.get('/api/messages', async (c) => c.json(await services.store.listNotifyMessages()))
  app.get('/api/messages/unread-count', async (c) => c.json({ count: await services.store.countUnreadMessages() }))
  app.post('/api/messages/:id/read', async (c) => {
    await services.store.markMessageRead(c.req.param('id'))
    return c.json({ ok: true })
  })
  app.post('/api/messages/read-all', async (c) => {
    await services.store.markAllMessagesRead()
    return c.json({ ok: true })
  })

  app.get('/api/schedules', async (c) => {
    const rows = await services.store.listNotifySchedules()
    return c.json(rows.map((row) => ({ ...row, enabled: Boolean(row.enabled) })))
  })
  app.post('/api/schedules', async (c) => {
    const body = z.object({
      workflowId: z.string().min(1),
      intervalMinutes: z.number().int().positive().max(24 * 60).default(60),
    }).parse(await c.req.json())
    const workflow = await services.store.getWorkflow(body.workflowId)
    if (!workflow) return c.json({ error: 'Workflow not found' }, 404)
    return c.json(await services.store.createNotifySchedule(body), 201)
  })
  app.post('/api/schedules/:id/enabled', async (c) => {
    const body = z.object({ enabled: z.boolean() }).parse(await c.req.json())
    await services.store.setNotifyScheduleEnabled(c.req.param('id'), body.enabled)
    return c.json({ ok: true })
  })
  app.delete('/api/schedules/:id', async (c) => {
    await services.store.deleteNotifySchedule(c.req.param('id'))
    return c.body(null, 204)
  })

  const enqueueByWorkflowId = async (workflowId: string) => {
    const response = await app.request(`http://127.0.0.1/api/workflows/${workflowId}/execute`, {
      method: 'POST',
      headers: { authorization: `Bearer ${services.token}` },
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(text || `schedule execute failed: ${response.status}`)
    }
    return response.json() as Promise<{ executionId: string }>
  }

  const scheduler = setInterval(() => {
    void (async () => {
      try {
        const due = await services.store.dueNotifySchedules()
        for (const item of due) {
          await services.store.markNotifyScheduleRun(item.id, item.intervalMinutes)
          console.log(`[schedule] trigger workflow=${item.workflowId} schedule=${item.id}`)
          void enqueueByWorkflowId(item.workflowId).catch((error) => {
            console.warn(`[schedule] execute failed workflow=${item.workflowId}`, error)
          })
        }
      } catch (error) {
        console.warn('[schedule] tick failed', error)
      }
    })()
  }, 30_000)
  scheduler.unref?.()

  app.get('/api/events', (c) => streamSSE(c, async (stream) => {
    let close = () => {}
    const heartbeat = setInterval(() => void stream.writeSSE({ event: 'heartbeat', data: '{}' }), 15_000)
    close = services.events.subscribe((event) => void stream.writeSSE({ event: event.type, data: JSON.stringify(event) }))
    stream.onAbort(() => { clearInterval(heartbeat); close() })
    while (!stream.aborted) await stream.sleep(1_000)
  }))

  app.get('/api/projects', async (c) => c.json(await services.store.listProjects()))
  app.post('/api/projects', async (c) => {
    const input = z.object({ name: z.string().min(1), path: z.string().min(1), gitUrl: z.string().url().optional() }).parse(await c.req.json())
    return c.json(await services.store.createProject({
      name: input.name,
      path: input.path,
      ...(input.gitUrl ? { gitUrl: input.gitUrl } : {}),
    }), 201)
  })
  app.post('/api/projects/:id/scan', async (c) => {
    const project = await services.store.getProject(c.req.param('id'))
    if (!project) return c.json({ error: 'Project not found' }, 404)
    const toolResult = await services.registry.execute('git.scan', { path: project.path }, {
      executionId: randomUUID(),
      emit: (event) => services.events.publish(event),
      values: new Map(),
    })
    const { snapshot: rawSnapshot } = z.object({ snapshot: z.unknown() }).parse(toolResult)
    const snapshot = gitSnapshotSchema.parse(rawSnapshot)
    const memory = await services.store.saveMemory(rawMemoryFromGit(snapshot))
    return c.json({ snapshot, memory })
  })
  app.get('/api/memories', async (c) => c.json(await services.store.listMemories(c.req.query('from'), c.req.query('to'))))
  app.post('/api/memories', async (c) => {
    const input = z.object({ date: z.string(), content: z.string().min(1), source: z.enum(['USER', 'GIT', 'FILE']).default('USER'), metadata: z.record(z.string(), z.unknown()).default({}) }).parse(await c.req.json())
    return c.json(await services.store.saveMemory({ ...input, createdAt: new Date().toISOString() }), 201)
  })
  app.post('/api/reports', async (c) => {
    const input = z.object({ type: z.enum(['DAILY', 'WEEKLY', 'QUARTERLY', 'YEARLY']), startDate: z.string(), endDate: z.string() }).parse(await c.req.json())
    const records = await services.store.listMemories(input.startDate, input.endDate)
    const content = fallbackSummary(records, `${input.type} Work Report`)
    return c.json(await services.store.saveReport({ ...input, content }), 201)
  })
  app.get('/api/settings', async (c) => c.json(await services.store.settings()))
  app.put('/api/settings/:key', async (c) => {
    const { value } = z.object({ value: z.string() }).parse(await c.req.json())
    return c.json(await services.store.setSetting(c.req.param('key'), value))
  })
  app.put('/api/credentials/:key', async (c) => {
    const { value } = z.object({ value: z.string().min(1) }).parse(await c.req.json())
    await services.credentials.save(c.req.param('key'), value)
    return c.json({ saved: true })
  })
  app.delete('/api/credentials/:key', async (c) => { await services.credentials.remove(c.req.param('key')); return c.body(null, 204) })

  const modelInputSchema = z.object({
    name: z.string().min(1),
    provider: modelConfigSchema.shape.provider,
    model: z.string().min(1),
    baseURL: z.string().url().optional(),
    apiKey: z.string().min(1),
    enabled: z.boolean().default(true),
  })
  app.get('/api/models', async (c) => c.json(await services.store.listModelProviders()))
  app.post('/api/models', async (c) => {
    const input = modelInputSchema.parse(await c.req.json())
    const credentialKey = `model.${randomUUID()}`
    await services.credentials.save(credentialKey, input.apiKey)
    const provider = await services.store.createModelProvider({
      name: input.name,
      providerType: input.provider,
      credentialKey,
      model: input.model,
      enabled: input.enabled,
      ...(input.baseURL ? { baseUrl: input.baseURL } : {}),
    })
    return c.json(provider, 201)
  })
  const configuredModel = async () => {
    const config = await services.store.enabledModelProvider()
    if (!config) return undefined
    const apiKey = await services.credentials.get(config.credentialKey)
    if (!apiKey) throw new Error('Enabled model credential is missing')
    const provider = modelConfigSchema.shape.provider.parse(config.providerType)
    return new ModelProvider(createLanguageModel({
      provider,
      model: config.model,
      apiKey,
      ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    }))
  }
  app.post('/api/models/test', async (c) => {
    const model = await configuredModel()
    if (!model) return c.json({ error: 'No model is enabled' }, 404)
    return c.json({ response: await model.generate('Reply with exactly: OK') })
  })

  app.post('/api/chat', async (c) => {
    const { message } = z.object({ message: z.string().min(1) }).parse(await c.req.json())
    const normalized = message.toLowerCase()
    if (normalized.includes('总结') || normalized.includes('summary')) {
      const today = new Date().toISOString().slice(0, 10)
      const records = await services.store.listMemories(today, today)
      return c.json({ message: fallbackSummary(records, 'Today Work Summary'), tool: 'memory.query' })
    }
    const model = await configuredModel()
    if (model) {
      return c.json({
        message: await model.generate(
          message,
          'You are WorkCopilot. Never emit executable scripts. Propose only validated Workflow DSL and registered tools.',
        ),
      })
    }
    return c.json({ message: 'I can execute workflows, scan Git projects, and summarize work memories.', tools: services.registry.list() })
  })
  app.post('/api/chat/stream', async (c) => {
    const { message } = z.object({ message: z.string().min(1) }).parse(await c.req.json())
    const model = await configuredModel()
    if (!model) return c.json({ error: 'No model is enabled' }, 404)
    return streamSSE(c, async (stream) => {
      for await (const token of model.stream(
        message,
        'You are WorkCopilot. Use Workflow DSL and registered tools; never generate executable automation code.',
      )) {
        await stream.writeSSE({ event: 'token', data: JSON.stringify({ token }) })
      }
      await stream.writeSSE({ event: 'done', data: '{}' })
    })
  })

  app.onError((error, c) => {
    console.error(error)
    if (error instanceof z.ZodError) return c.json({ error: 'Validation failed', issues: error.issues }, 400)
    if (error instanceof NameConflictError) return c.json({ error: error.message }, 409)
    return c.json({ error: error.message }, 500)
  })
  return app
}
