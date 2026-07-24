export type WorkflowSummary = {
  id: string
  name: string
  intent: string
  kind?: 'login' | 'app' | string
  homeUrl?: string
  description?: string
  createdAt?: string
  updatedAt?: string
  steps?: Array<{
    id: string
    tool: string
    params: Record<string, unknown>
    timeoutMs?: number
    retries?: number
    requiresConfirmation?: boolean
  }>
}

export function formatWorkflowTime(iso?: string) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
