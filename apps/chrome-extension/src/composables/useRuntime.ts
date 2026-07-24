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
  ) {
    await request('/api/recordings', {
      method: 'POST',
      body: JSON.stringify({
        name,
        kind,
        intent: kind === 'login' ? 'browser.login' : 'browser.app',
        events,
      }),
    })
    workflows.value = await request('/api/workflows')
  }

  async function getWorkflow(id: string): Promise<WorkflowSummary> {
    return request(`/api/workflows/${id}`)
  }

  async function execute(id: string) {
    return request(`/api/workflows/${id}/execute`, { method: 'POST' })
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

  return {
    token,
    workflows: readonly(workflows),
    status: readonly(status),
    connect,
    saveCredential,
    saveRecording,
    getWorkflow,
    execute,
    deleteWorkflow,
    deleteAllWorkflows,
  }
}
