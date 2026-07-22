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

export const recordingEventSchema = z.object({
  id: z.string().default(() => randomUUID()),
  type: z.enum(['click', 'input', 'navigation', 'submit']),
  url: z.string().url(),
  timestamp: z.string().datetime(),
  element: elementSnapshotSchema.optional(),
  value: z.string().optional(),
  credentialKey: z.string().optional(),
})
export type RecordingEvent = z.infer<typeof recordingEventSchema>

export const recordingSchema = z.object({
  id: z.string().default(() => randomUUID()),
  name: z.string().min(1),
  intent: z.string().min(1),
  events: z.array(recordingEventSchema).min(1),
})
export type Recording = z.infer<typeof recordingSchema>

function eventToStep(event: RecordingEvent, index: number): WorkflowStep {
  const common = { id: `step-${index + 1}`, timeoutMs: 30_000, retries: 1, requiresConfirmation: false }
  if (event.type === 'navigation') {
    return { ...common, tool: 'browser.open', params: { url: event.url } }
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

export function recordingToWorkflow(input: Recording): Workflow {
  const recording = recordingSchema.parse(input)
  return workflowSchema.parse({
    name: recording.name,
    intent: recording.intent,
    description: `Generated from recording ${recording.id}`,
    version: 1,
    steps: recording.events.map(eventToStep),
  })
}
