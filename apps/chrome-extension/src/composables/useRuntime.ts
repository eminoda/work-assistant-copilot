import { readonly, shallowRef } from 'vue'
import type { RecordingEvent } from '@workcopilot/browser-recorder'

const runtimeUrl = 'http://127.0.0.1:4317'

export function useRuntime() {
  const token = shallowRef(localStorage.getItem('workcopilot.token') ?? '')
  const workflows = shallowRef<Array<{ id: string; name: string; intent: string }>>([])
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
    if (!response.ok) throw new Error((await response.text()) || response.statusText)
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

  async function saveRecording(name: string, events: RecordingEvent[]) {
    await request('/api/recordings', {
      method: 'POST',
      body: JSON.stringify({ name, intent: 'browser.workflow', events }),
    })
    workflows.value = await request('/api/workflows')
  }

  async function execute(id: string) {
    return request(`/api/workflows/${id}/execute`, { method: 'POST' })
  }

  return {
    token,
    workflows: readonly(workflows),
    status: readonly(status),
    connect,
    saveCredential,
    saveRecording,
    execute,
  }
}
