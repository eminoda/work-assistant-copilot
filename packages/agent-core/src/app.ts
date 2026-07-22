import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { ToolRegistry, type AgentEvent } from '@workcopilot/tool-registry'
import { WorkflowEngine, workflowSchema, type ExecutionResult } from '@workcopilot/workflow-engine'
import { recordingSchema, recordingToWorkflow } from '@workcopilot/browser-recorder'
import { registerBrowserTools, PlaywrightRuntime } from '@workcopilot/playwright-runtime'
import { LocalCredentialProvider, getOrCreateLocalToken } from '@workcopilot/credential-provider'
import { gitSnapshotSchema, scanGitRepository } from '@workcopilot/git-analyzer'
import { fallbackSummary, rawMemoryFromGit } from '@workcopilot/memory-engine'
import { createLanguageModel, ModelProvider, modelConfigSchema } from '@workcopilot/model-provider'
import { registerExportTools } from '@workcopilot/feishu-adapter'
import { WorkCopilotStore } from './store.js'

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
  const browser = registerBrowserTools(registry)
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
  app.post('/api/workflows', async (c) => {
    const workflow = workflowSchema.parse(await c.req.json())
    return c.json(await services.store.saveWorkflow(workflow), 201)
  })
  app.delete('/api/workflows/:id', async (c) => { await services.store.deleteWorkflow(c.req.param('id')); return c.body(null, 204) })
  app.post('/api/recordings', async (c) => {
    const recording = recordingSchema.parse(await c.req.json())
    const firstUrl = recording.events[0]?.url
    await services.store.saveRecording({
      name: recording.name,
      intent: recording.intent,
      events: recording.events,
      ...(firstUrl ? { url: firstUrl } : {}),
    })
    const workflow = await services.store.saveWorkflow(recordingToWorkflow(recording))
    return c.json({ workflow }, 201)
  })

  const active = new Map<string, Promise<ExecutionResult>>()
  app.post('/api/workflows/:id/execute', async (c) => {
    const workflow = await services.store.getWorkflow(c.req.param('id'))
    if (!workflow) return c.json({ error: 'Workflow not found' }, 404)
    const requestId = randomUUID()
    const promise = services.engine.execute(
      workflow,
      (event) => services.events.publish(event),
      undefined,
      requestId,
    ).then(async (result) => {
      await services.store.saveExecution(workflow.id, result)
      return result
    })
    active.set(requestId, promise)
    void promise.finally(() => active.delete(requestId))
    return c.json({ executionId: requestId }, 202)
  })
  app.get('/api/executions/:id', async (c) => {
    const pending = active.get(c.req.param('id'))
    if (pending) return c.json({ id: c.req.param('id'), status: 'RUNNING' })
    const execution = await services.store.getExecution(c.req.param('id'))
    return execution ? c.json(execution) : c.json({ error: 'Execution not found' }, 404)
  })
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
    return c.json({ error: error.message }, 500)
  })
  return app
}
