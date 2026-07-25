import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { ToolRegistry, type AgentEvent, type ToolContext } from '@workcopilot/tool-registry'

export {
  compactSelectorText,
  decodeHtmlEntities,
  flexibleTextRegex,
  normalizeMatchText,
} from './html-text.js'


export const selectorScopeSchema = z.object({
  tag: z.string().optional(),
  ariaLabel: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  stableAttribute: z.object({ name: z.string(), value: z.string() }).optional(),
  css: z.string().optional(),
})
export type SelectorScope = z.infer<typeof selectorScopeSchema>

export const selectorSchema = z.object({
  ariaLabel: z.string().optional(),
  role: z.string().optional(),
  text: z.string().optional(),
  placeholder: z.string().optional(),
  stableAttribute: z.object({ name: z.string(), value: z.string() }).optional(),
  css: z.string().optional(),
  /** Nearest useful ancestors first (max 2). Used to scope ambiguous text/role matches. */
  parents: z.array(selectorScopeSchema).max(2).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
})
export type ElementSelector = z.infer<typeof selectorSchema>

export const workflowStepSchema = z.object({
  id: z.string(),
  tool: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
  saveAs: z.string().optional(),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  retries: z.number().int().min(0).max(3).default(0),
  requiresConfirmation: z.boolean().default(false),
})
export type WorkflowStep = z.infer<typeof workflowStepSchema>

export const workflowKindSchema = z.enum(['login', 'app'])
export type WorkflowKind = z.infer<typeof workflowKindSchema>

export const workflowSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  intent: z.string().min(1),
  description: z.string().default(''),
  version: z.literal(1).default(1),
  kind: workflowKindSchema.default('app'),
  /** For login workflows: last captured URL used as session home / fast-path entry. */
  homeUrl: z.string().url().optional(),
  /** Run this workflow first when executing (e.g. login before app). */
  prerequisiteWorkflowId: z.string().min(1).optional(),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
  steps: z.array(workflowStepSchema).min(1),
})
export type Workflow = z.infer<typeof workflowSchema>

/** origin + pathname (trailing slash ignored) for workflow chain matching. */
export function documentPathKey(url: string): string | undefined {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/\/+$/, '') || '/'
    return `${parsed.origin}${path}`
  } catch {
    return undefined
  }
}

export function workflowEntryUrl(workflow: Pick<Workflow, 'steps' | 'homeUrl'>): string | undefined {
  for (const step of workflow.steps) {
    if (step.tool === 'browser.open' && typeof step.params.url === 'string') return step.params.url
  }
  return undefined
}

export function workflowExitUrl(workflow: Pick<Workflow, 'steps' | 'homeUrl'>): string | undefined {
  if (workflow.homeUrl) return workflow.homeUrl
  for (let index = workflow.steps.length - 1; index >= 0; index -= 1) {
    const step = workflow.steps[index]
    if (step?.tool === 'browser.open' && typeof step.params.url === 'string') return step.params.url
  }
  return undefined
}

/** Prerequisite last path must equal current first path. */
export function canLinkPrerequisite(
  prerequisite: Pick<Workflow, 'steps' | 'homeUrl'>,
  current: Pick<Workflow, 'steps' | 'homeUrl'> | { entryUrl?: string },
): boolean {
  const exit = documentPathKey(workflowExitUrl(prerequisite) || '')
  const entry = 'entryUrl' in current && current.entryUrl
    ? documentPathKey(current.entryUrl)
    : documentPathKey(workflowEntryUrl(current as Pick<Workflow, 'steps' | 'homeUrl'>) || '')
  return Boolean(exit && entry && exit === entry)
}


export const executionStatusSchema = z.enum(['PENDING', 'RUNNING', 'WAITING_CONFIRMATION', 'SUCCESS', 'FAILED', 'CANCELLED'])
export type ExecutionStatus = z.infer<typeof executionStatusSchema>
export type ExecutionResult = {
  id: string
  status: ExecutionStatus
  startedAt: string
  finishedAt?: string
  outputs: Record<string, unknown>
  error?: string
  events: AgentEvent[]
}

export type ConfirmationHandler = (step: WorkflowStep, executionId: string) => Promise<boolean>

function resolveReferences(value: unknown, values: Map<string, unknown>): unknown {
  if (typeof value === 'string' && value.startsWith('$')) return values.get(value.slice(1))
  if (Array.isArray(value)) return value.map((item) => resolveReferences(item, values))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveReferences(item, values)]))
  }
  return value
}

function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('Execution cancelled'))
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error('Execution cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

export class WorkflowEngine {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly confirm: ConfirmationHandler = async () => true,
  ) {}

  async execute(
    input: z.input<typeof workflowSchema>,
    onEvent: (event: AgentEvent) => void = () => {},
    signal?: AbortSignal,
    executionId = randomUUID(),
  ): Promise<ExecutionResult> {
    const workflow = workflowSchema.parse(input)
    const events: AgentEvent[] = []
    const values = new Map<string, unknown>()
    const emit = (event: AgentEvent) => { events.push(event); onEvent(event) }
    const startedAt = new Date().toISOString()
    emit({ type: 'workflow.started', executionId, message: workflow.name, timestamp: startedAt })

    try {
      for (const step of workflow.steps) {
        if (signal?.aborted) throw new Error('Execution cancelled')
        if (step.requiresConfirmation) {
          emit({
            type: 'human.confirm.required', executionId, tool: step.tool,
            message: `Confirmation required for ${step.tool}`, timestamp: new Date().toISOString(),
          })
          if (!(await this.confirm(step, executionId))) throw new Error('User rejected operation')
        }
        const context: ToolContext = { executionId, emit, values, ...(signal ? { signal } : {}) }
        let lastError: unknown
        for (let attempt = 0; attempt <= step.retries; attempt += 1) {
          try {
            const params = resolveReferences(step.params, values)
            const result = await raceWithAbort(
              Promise.race([
                this.registry.execute(step.tool, params, context),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`Step timed out: ${step.id}`)), step.timeoutMs)),
              ]),
              signal,
            )
            if (step.saveAs) values.set(step.saveAs, result)
            lastError = undefined
            break
          } catch (error) {
            lastError = error
            if (signal?.aborted) break
          }
        }
        if (lastError) throw lastError
      }
      const finishedAt = new Date().toISOString()
      emit({ type: 'workflow.finished', executionId, message: workflow.name, timestamp: finishedAt })
      return { id: executionId, status: 'SUCCESS', startedAt, finishedAt, outputs: Object.fromEntries(values), events }
    } catch (error) {
      const finishedAt = new Date().toISOString()
      const message = error instanceof Error ? error.message : String(error)
      emit({ type: 'workflow.failed', executionId, message, timestamp: finishedAt })
      return { id: executionId, status: signal?.aborted ? 'CANCELLED' : 'FAILED', startedAt, finishedAt, outputs: Object.fromEntries(values), error: message, events }
    }
  }
}
