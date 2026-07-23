import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { selectorSchema, workflowSchema, type Workflow, type WorkflowStep } from '@workcopilot/workflow-engine'

export const elementSnapshotSchema = z.object({
  tag: z.string(),
  selector: selectorSchema,
  attributes: z.record(z.string(), z.string()).default({}),
  text: z.string().optional(),
  html: z.string().max(20_000).optional(),
})
export type ElementSnapshot = z.infer<typeof elementSnapshotSchema>

export const cookieRecordSchema = z.object({
  name: z.string().min(1),
  value: z.string(),
  domain: z.string().min(1),
  path: z.string().default('/'),
  expires: z.number().optional(),
  httpOnly: z.boolean().optional(),
  secure: z.boolean().optional(),
  sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
})
export type CookieRecord = z.infer<typeof cookieRecordSchema>

export const recordingEventSchema = z.object({
  id: z.string().default(() => randomUUID()),
  type: z.enum(['click', 'input', 'navigation', 'submit', 'tab', 'cookies']),
  url: z.string().url(),
  timestamp: z.string().datetime(),
  seq: z.number().int().nonnegative().optional(),
  tabId: z.number().int().optional(),
  tabAction: z.enum(['activated', 'created', 'updated', 'removed']).optional(),
  element: elementSnapshotSchema.optional(),
  value: z.string().optional(),
  credentialKey: z.string().optional(),
  cookies: z.array(cookieRecordSchema).optional(),
  cookieCredentialKey: z.string().optional(),
})
export type RecordingEvent = z.infer<typeof recordingEventSchema>

export const recordingSchema = z.object({
  id: z.string().default(() => randomUUID()),
  name: z.string().min(1),
  intent: z.string().min(1),
  events: z.array(recordingEventSchema).min(1),
})
export type Recording = z.infer<typeof recordingSchema>

function eventToStep(event: RecordingEvent, index: number): WorkflowStep | undefined {
  const common = { id: `step-${index + 1}`, timeoutMs: 30_000, retries: 1, requiresConfirmation: false }
  if (event.type === 'navigation' || event.type === 'tab') {
    return { ...common, tool: 'browser.open', params: { url: event.url } }
  }
  if (event.type === 'cookies') {
    if (event.cookieCredentialKey) {
      return {
        ...common,
        tool: 'browser.setCookies',
        params: { credentialKey: event.cookieCredentialKey, url: event.url },
      }
    }
    if (event.cookies?.length) {
      return { ...common, tool: 'browser.setCookies', params: { cookies: event.cookies, url: event.url } }
    }
    return undefined
  }
  if (!event.element) throw new Error(`Missing element snapshot for ${event.type}`)
  if (event.type === 'input') {
    return {
      ...common,
      tool: 'browser.input',
      params: {
        target: event.element.selector,
        ...(event.credentialKey ? { credentialKey: event.credentialKey } : { value: event.value ?? '' }),
      },
    }
  }
  return {
    ...common,
    tool: 'browser.click',
    params: { target: event.element.selector },
    requiresConfirmation: event.type === 'submit',
  }
}

export function sortRecordingEvents(events: RecordingEvent[]): RecordingEvent[] {
  return [...events].sort((left, right) => {
    const seqDelta = (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER)
    if (seqDelta !== 0) return seqDelta
    return left.timestamp.localeCompare(right.timestamp)
  })
}

export function recordingToWorkflow(input: Recording): Workflow {
  const recording = recordingSchema.parse(input)
  const events = sortRecordingEvents(recording.events).filter((event) => {
    return !(event.type === 'tab' && event.tabAction === 'removed')
  })
  if (!events.some((event) => event.type === 'navigation' || event.type === 'tab') && events[0]?.url) {
    events.unshift({
      id: randomUUID(),
      type: 'navigation',
      url: events[0].url,
      timestamp: events[0].timestamp,
      seq: 0,
    })
  }
  const steps = events.reduce<WorkflowStep[]>((acc, event) => {
    const step = eventToStep(event, acc.length)
    if (!step) return acc
    const previous = acc[acc.length - 1]
    if (
      step.tool === 'browser.open'
      && previous?.tool === 'browser.open'
      && previous.params.url === step.params.url
    ) {
      return acc
    }
    // Keep the latest cookie snapshot when several are consecutive.
    if (step.tool === 'browser.setCookies' && previous?.tool === 'browser.setCookies') {
      acc[acc.length - 1] = { ...step, id: previous.id }
      return acc
    }
    acc.push({ ...step, id: `step-${acc.length + 1}` })
    return acc
  }, [])
  return workflowSchema.parse({
    name: recording.name,
    intent: recording.intent,
    description: `Generated from recording ${recording.id}`,
    version: 1,
    steps,
  })
}
