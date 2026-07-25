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

type StepLike = { tool: string; params: Record<string, unknown> }
type WorkflowLike = {
  homeUrl?: string | undefined
  steps?: StepLike[] | undefined
}

export function workflowEntryUrl(workflow: WorkflowLike): string | undefined {
  for (const step of workflow.steps || []) {
    if (step.tool === 'browser.open' && typeof step.params.url === 'string') return step.params.url
  }
  return undefined
}

export function workflowExitUrl(workflow: WorkflowLike): string | undefined {
  if (workflow.homeUrl) return workflow.homeUrl
  const steps = workflow.steps || []
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index]
    if (step?.tool === 'browser.open' && typeof step.params.url === 'string') return step.params.url
  }
  return undefined
}

/** Prerequisite last path must equal current first path. */
export function canLinkPrerequisite(
  prerequisite: WorkflowLike,
  current: WorkflowLike | { entryUrl?: string | undefined },
): boolean {
  const exit = documentPathKey(workflowExitUrl(prerequisite) || '')
  const entry = 'entryUrl' in current && current.entryUrl
    ? documentPathKey(current.entryUrl)
    : documentPathKey(workflowEntryUrl(current as WorkflowLike) || '')
  return Boolean(exit && entry && exit === entry)
}

export function firstEventUrl(
  events: Array<{ type: string; url: string; seq?: number | undefined; timestamp: string }>,
): string | undefined {
  const ordered = [...events].sort((left, right) => {
    const seqDelta = (left.seq ?? Number.MAX_SAFE_INTEGER) - (right.seq ?? Number.MAX_SAFE_INTEGER)
    if (seqDelta !== 0) return seqDelta
    return left.timestamp.localeCompare(right.timestamp)
  })
  for (const event of ordered) {
    if (event.type === 'cookies') continue
    if (/^https?:/i.test(event.url)) return event.url
  }
  return undefined
}
