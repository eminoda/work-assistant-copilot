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

export function cookieIdentity(cookie: Pick<CookieRecord, 'name' | 'domain' | 'path'>): string {
  return `${cookie.name}|${cookie.domain}|${cookie.path || '/'}`
}

/** Cookies that are new or whose value changed vs the first-visit baseline. */
export function diffCookies(baseline: CookieRecord[], current: CookieRecord[]): CookieRecord[] {
  const before = new Map(baseline.map((cookie) => [cookieIdentity(cookie), cookie]))
  const changed: CookieRecord[] = []
  for (const cookie of current) {
    const previous = before.get(cookieIdentity(cookie))
    if (!previous || previous.value !== cookie.value) changed.push(cookie)
  }
  return changed
}

export const recordingEventSchema = z.object({
  id: z.string().default(() => randomUUID()),
  type: z.enum(['click', 'input', 'navigation', 'submit', 'tab', 'cookies', 'waitNavigation', 'extract']),
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
  /** Wait until URL leaves fromUrl / matches expectedUrl. Default 90s for QR/SMS handoff. */
  waitTimeoutMs: z.number().int().positive().optional(),
  fromUrl: z.string().url().optional(),
  expectedUrl: z.string().url().optional(),
  /** Named text capture for notification monitoring. */
  extractLabel: z.string().optional(),
  extractText: z.string().optional(),
})
export type RecordingEvent = z.infer<typeof recordingEventSchema>

export const recordingSchema = z.object({
  id: z.string().default(() => randomUUID()),
  name: z.string().min(1),
  intent: z.string().min(1),
  kind: z.enum(['login', 'app']).default('app'),
  events: z.array(recordingEventSchema).min(1),
})
export type Recording = z.infer<typeof recordingSchema>
export type RecordingInput = z.input<typeof recordingSchema>

export function lastRecordedUrl(events: RecordingEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!event || event.type === 'cookies') continue
    if (/^https?:/i.test(event.url)) return event.url
  }
  return undefined
}

/** Compare locations; empty/#/#/ hash on target matches any hash on the same path. */
export function isSameDocumentLocation(current: string, target: string): boolean {
  try {
    const a = new URL(current)
    const b = new URL(target)
    if (a.origin !== b.origin) return false
    const pathA = a.pathname.replace(/\/+$/, '') || '/'
    const pathB = b.pathname.replace(/\/+$/, '') || '/'
    if (pathA !== pathB) return false
    const hashB = !b.hash || b.hash === '#' || b.hash === '#/' ? '' : b.hash
    if (!hashB) return true
    const hashA = !a.hash || a.hash === '#' || a.hash === '#/' ? '' : a.hash
    return hashA === hashB
  } catch {
    return current === target
  }
}

export function sessionCredentialKeyForUrl(url: string): string {
  try {
    return `${new URL(url).hostname}.session`
  } catch {
    return 'unknown.session'
  }
}

function eventToStep(event: RecordingEvent, index: number): WorkflowStep | undefined {
  const common = { id: `step-${index + 1}`, timeoutMs: 30_000, retries: 1, requiresConfirmation: false }
  if (event.type === 'extract') {
    // Notification monitor metadata — not a browser replay step.
    return undefined
  }
  if (event.type === 'waitNavigation') {
    return {
      ...common,
      tool: 'browser.waitNavigation',
      timeoutMs: event.waitTimeoutMs ?? 90_000,
      params: {
        fromUrl: event.fromUrl ?? event.url,
        timeoutMs: event.waitTimeoutMs ?? 90_000,
        ...(event.expectedUrl ? { expectedUrl: event.expectedUrl } : {}),
      },
    }
  }
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

export function recordingToWorkflow(input: RecordingInput): Workflow {
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
  const homeUrl = lastRecordedUrl(events)
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

  const kind = recording.kind
  if (kind === 'login') {
    // Login session cookies are applied only during pretest (inject → open homeUrl).
    // Do not replay setCookies mid-flow — that re-injected first-visit noise (e.g. acw_tc).
    for (let index = steps.length - 1; index >= 0; index -= 1) {
      if (steps[index]?.tool === 'browser.setCookies') steps.splice(index, 1)
    }
    // homeUrl is for session pretest; login redirect already lands there.
    if (homeUrl) {
      while (steps.length > 0) {
        const last = steps[steps.length - 1]
        if (!last) break
        const url = last.params.url
        if (typeof url !== 'string') break
        const onHome = isSameDocumentLocation(url, homeUrl) || isSameDocumentLocation(homeUrl, url)
        if (!onHome) break
        if (last.tool === 'browser.open') {
          steps.pop()
          continue
        }
        break
      }
    }
    steps.forEach((step, index) => {
      step.id = `step-${index + 1}`
    })
  }

  const intent = recording.intent || (kind === 'login' ? 'browser.login' : 'browser.app')
  return workflowSchema.parse({
    name: recording.name,
    intent,
    kind,
    ...(homeUrl ? { homeUrl } : {}),
    description: kind === 'login'
      ? `Login workflow${homeUrl ? `; home=${homeUrl}` : ''}`
      : `Generated from recording ${recording.id}`,
    version: 1,
    steps,
  })
}
