import { readonly, shallowRef } from 'vue'
import type { RecordingEvent } from '@workcopilot/browser-recorder'
import type { WorkflowSummary } from '../workflowTypes'

const runtimeUrl = 'http://127.0.0.1:4317'

export function useRuntime() {
  const token = shallowRef(localStorage.getItem('workcopilot.token') ?? '')
  const workflows = shallowRef<WorkflowSummary[]>([])
  const status = shallowRef(token.value ? 'Ready' : 'Disconnected')

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${runtimeUrl}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${token.value}`,
        'content-type': 'application/json',
        ...options.headers,
      },
    })
    if (!response.ok) {
      const text = await response.text()
      let message = text || response.statusText
      try {
        const body = JSON.parse(text) as { error?: string }
        if (body?.error) message = body.error
      } catch {
        // keep raw text
      }
      throw new Error(message)
    }
    return response.status === 204 ? undefined : response.json()
  }

  async function connect(nextToken: string) {
    token.value = nextToken.trim()
    localStorage.setItem('workcopilot.token', token.value)
    const health = await fetch(`${runtimeUrl}/api/health`).then((response) => response.json())
    status.value = health.status === 'ok' ? 'Connected' : 'Unavailable'
    workflows.value = await request('/api/workflows')
  }

  async function saveCredential(key: string, value: string) {
    await request(`/api/credentials/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    })
  }

  async function saveRecording(
    name: string,
    events: RecordingEvent[],
    kind: 'login' | 'app' = 'app',
    prerequisiteWorkflowId?: string,
  ) {
    await request('/api/recordings', {
      method: 'POST',
      body: JSON.stringify({
        name,
        kind,
        intent: kind === 'login' ? 'browser.login' : 'browser.app',
        events,
        ...(prerequisiteWorkflowId ? { prerequisiteWorkflowId } : {}),
      }),
    })
    workflows.value = await request('/api/workflows')
  }

  async function setPrerequisiteWorkflow(id: string, prerequisiteWorkflowId: string | null) {
    await request(`/api/workflows/${encodeURIComponent(id)}/prerequisite`, {
      method: 'PUT',
      body: JSON.stringify({ prerequisiteWorkflowId }),
    })
    workflows.value = await request('/api/workflows')
  }

  async function renameWorkflow(id: string, name: string) {
    await request(`/api/workflows/${encodeURIComponent(id)}/name`, {
      method: 'PUT',
      body: JSON.stringify({ name }),
    })
    workflows.value = await request('/api/workflows')
  }

  async function getWorkflow(id: string): Promise<WorkflowSummary> {
    return request(`/api/workflows/${id}`)
  }

  async function execute(id: string) {
    return request(`/api/workflows/${id}/execute`, { method: 'POST' }) as Promise<{ executionId: string }>
  }

  async function cancelExecution(executionId: string) {
    return request(`/api/executions/${encodeURIComponent(executionId)}/cancel`, {
      method: 'POST',
    }) as Promise<{ ok: boolean; status: string }>
  }

  async function waitForExecution(
    executionId: string,
    options: {
      intervalMs?: number
      timeoutMs?: number
      onUpdate?: (execution: { status?: string; phase?: string; error?: string }) => void
    } = {},
  ) {
    const intervalMs = options.intervalMs ?? 800
    const timeoutMs = options.timeoutMs ?? 10 * 60_000
    const started = Date.now()
    let sawRunning = false
    while (Date.now() - started < timeoutMs) {
      let execution: { status?: string; phase?: string; error?: string }
      try {
        execution = await request(`/api/executions/${encodeURIComponent(executionId)}`) as {
          status?: string
          phase?: string
          error?: string
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Runtime restarted or record missing after a completed run.
        if (sawRunning && /not found/i.test(message)) {
          return { status: 'CANCELLED', error: message }
        }
        throw error
      }
      if (!execution || execution.error === 'Execution not found') {
        if (sawRunning) return { status: 'CANCELLED', error: 'Execution not found' }
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
        continue
      }
      options.onUpdate?.(execution)
      const status = String(execution.status || '').toUpperCase()
      if (status === 'RUNNING') {
        sawRunning = true
        await new Promise((resolve) => setTimeout(resolve, intervalMs))
        continue
      }
      if (status) return execution
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
    throw new Error(`Execution timed out: ${executionId}`)
  }

  async function deleteWorkflow(id: string) {
    await request(`/api/workflows/${id}`, { method: 'DELETE' })
    workflows.value = await request('/api/workflows')
  }

  async function deleteAllWorkflows() {
    const ids = workflows.value.map((workflow) => workflow.id)
    for (const id of ids) {
      await request(`/api/workflows/${id}`, { method: 'DELETE' })
    }
    workflows.value = await request('/api/workflows')
  }

  async function listMessages() {
    return request('/api/messages') as Promise<Array<{
      id: string
      title: string
      tag: string
      label: string
      value: string
      previousValue?: string | null
      workflowId?: string | null
      unread: boolean
      updatedAt: string
      createdAt: string
    }>>
  }

  async function unreadMessageCount() {
    const result = await request('/api/messages/unread-count') as { count: number }
    return Number(result.count || 0)
  }

  async function markMessageRead(id: string) {
    await request(`/api/messages/${encodeURIComponent(id)}/read`, { method: 'POST' })
  }

  async function markAllMessagesRead() {
    await request('/api/messages/read-all', { method: 'POST' })
  }

  async function listSchedules() {
    return request('/api/schedules') as Promise<Array<{
      id: string
      workflowId: string
      intervalMinutes: number
      enabled: boolean
      nextRunAt?: string | null
      lastRunAt?: string | null
    }>>
  }

  async function createSchedule(input: { workflowId: string; intervalMinutes: number }) {
    return request('/api/schedules', {
      method: 'POST',
      body: JSON.stringify(input),
    })
  }

  async function setScheduleEnabled(id: string, enabled: boolean) {
    await request(`/api/schedules/${encodeURIComponent(id)}/enabled`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    })
  }

  async function deleteSchedule(id: string) {
    await request(`/api/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  async function listJournals(from: string, to: string) {
    const query = new URLSearchParams({ from, to })
    return request(`/api/journals?${query}`) as Promise<import('../journalTypes').DailyJournal[]>
  }

  async function getJournal(date: string) {
    return request(`/api/journals/${encodeURIComponent(date)}`) as Promise<import('../journalTypes').DailyJournal>
  }

  async function addJournalItem(date: string, title: string, description: string) {
    return request(`/api/journals/${encodeURIComponent(date)}/items`, {
      method: 'POST',
      body: JSON.stringify({ title, description }),
    }) as Promise<import('../journalTypes').DailyJournal>
  }

  async function analyzeJournalDay(date: string) {
    return request(`/api/journals/${encodeURIComponent(date)}/analyze`, {
      method: 'POST',
      body: '{}',
    }) as Promise<{
      skipped: boolean
      reason?: string | null
      cached?: boolean
      markdown: string
      journal: import('../journalTypes').DailyJournal
    }>
  }

  async function summarizeJournals(from: string, to: string, kind: 'monthly' | 'weekly' | 'range' = 'monthly') {
    return request('/api/journals/summarize', {
      method: 'POST',
      body: JSON.stringify({ from, to, kind }),
    }) as Promise<{
      skipped: boolean
      reason?: string
      summary: string
      bullets: string[]
      raw: string
      kind?: string
      label?: string
    }>
  }

  async function getSettings() {
    return request('/api/settings') as Promise<Record<string, string>>
  }

  async function setScanRoots(roots: string[]) {
    return request('/api/settings/scan.roots', {
      method: 'PUT',
      body: JSON.stringify({ roots }),
    })
  }

  async function listModels() {
    return request('/api/models') as Promise<Array<{
      id: string
      name: string
      providerType: string
      baseUrl: string | null
      model: string
      enabled: boolean
    }>>
  }

  async function saveModel(input: {
    name: string
    provider: string
    model: string
    baseURL?: string
    apiKey: string
    enabled?: boolean
  }) {
    return request('/api/models', {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        provider: input.provider,
        model: input.model,
        apiKey: input.apiKey,
        enabled: input.enabled ?? true,
        ...(input.baseURL ? { baseURL: input.baseURL } : {}),
      }),
    })
  }

  async function triggerJournalScan(force = true, lookbackDays = 7) {
    return request('/api/projects/discover-scan', {
      method: 'POST',
      body: JSON.stringify({ force, lookbackDays }),
    })
  }

  async function chat(message: string) {
    return request('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }) as Promise<{
      message: string
      intent?: string
      navigateTarget?: string
      skillCalls?: Array<{ name: string; args?: unknown }>
      skills?: string[]
      steps?: unknown
    }>
  }

  return {
    token,
    workflows: readonly(workflows),
    status: readonly(status),
    connect,
    saveCredential,
    saveRecording,
    setPrerequisiteWorkflow,
    renameWorkflow,
    getWorkflow,
    execute,
    cancelExecution,
    waitForExecution,
    deleteWorkflow,
    deleteAllWorkflows,
    listMessages,
    unreadMessageCount,
    markMessageRead,
    markAllMessagesRead,
    listSchedules,
    createSchedule,
    setScheduleEnabled,
    deleteSchedule,
    listJournals,
    getJournal,
    addJournalItem,
    analyzeJournalDay,
    summarizeJournals,
    getSettings,
    setScanRoots,
    listModels,
    saveModel,
    triggerJournalScan,
    chat,
  }
}
