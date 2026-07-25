import { readonly, shallowRef } from 'vue'

const baseUrl = 'http://127.0.0.1:4317'

export type UsageDay = {
  date: string
  callCount: number
  inputChars: number
  outputChars: number
}

export type ProjectRow = {
  id: string
  name: string
  path: string
  gitUrl: string | null
  createdAt: string
}

export type ProjectDetail = {
  project: ProjectRow
  snapshots: Array<{
    id: string
    commitHash: string
    summary: string | null
    createdAt: string
  }>
  journals: Array<{
    id: string
    date: string
    itemCount: number
    gitItemCount: number
    hasAi: boolean
    aiUpToDate: boolean
    contentHash: string
    updatedAt: string
  }>
}

export type WorkflowSummary = {
  id: string
  name: string
  intent: string
  kind?: string
  homeUrl?: string
  steps?: Array<{ id: string; tool: string; params: Record<string, unknown> }>
  prerequisiteWorkflowId?: string
  createdAt?: string
  updatedAt?: string
}

export type RecordingRow = {
  id: string
  name: string
  intent: string
  url: string | null
  status: string
  createdAt: string
  updatedAt: string
}

async function readOrCreateLocalToken(): Promise<string | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const next = await invoke<string>('get_or_create_runtime_token')
    const trimmed = next?.trim()
    return trimmed ? trimmed : null
  } catch {
    return null
  }
}

export function useRuntimeClient() {
  const token = shallowRef(localStorage.getItem('workcopilot.token') ?? '')
  const connected = shallowRef(false)
  const loading = shallowRef(false)

  async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
    loading.value = true
    try {
      const response = await fetch(`${baseUrl}${path}`, {
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
          // keep text
        }
        throw new Error(message)
      }
      return response.status === 204 ? (undefined as T) : response.json()
    } finally {
      loading.value = false
    }
  }

  async function ensureLocalToken() {
    const local = await readOrCreateLocalToken()
    if (!local) return token.value.trim()
    token.value = local
    localStorage.setItem('workcopilot.token', local)
    return local
  }

  async function connect(nextToken: string) {
    const trimmed = nextToken.trim()
    if (!trimmed) throw new Error('请输入 runtime token')

    let health: { status?: string }
    try {
      const response = await fetch(`${baseUrl}/api/health`)
      if (!response.ok) throw new Error('Runtime 未启动')
      health = await response.json()
    } catch (error) {
      if (error instanceof Error && error.message === 'Runtime 未启动') throw error
      throw new Error(
        '无法连接本地 Runtime（http://127.0.0.1:4317）。请先运行 pnpm runtime，或从源码目录启动桌面端以便自动拉起。',
      )
    }
    if (health.status !== 'ok') throw new Error('Runtime 不可用')

    token.value = trimmed
    localStorage.setItem('workcopilot.token', trimmed)

    const authorized = await fetch(`${baseUrl}/api/workflows`, {
      headers: { authorization: `Bearer ${trimmed}` },
    })
    if (!authorized.ok) {
      connected.value = false
      throw new Error('Token 无效，请检查 runtime.token.secret')
    }

    connected.value = true
  }

  async function autoConnect(retries = 20, delayMs = 500) {
    await ensureLocalToken()
    const saved = token.value.trim()
    if (!saved) return

    let lastError: unknown
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        await connect(saved)
        return
      } catch (error) {
        lastError = error
        connected.value = false
        if (attempt < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }
    console.warn('[desktop] auto-connect failed', lastError)
  }

  async function getSettings() {
    return request<Record<string, string>>('/api/settings')
  }

  async function setScanRoots(roots: string[]) {
    return request('/api/settings/scan.roots', {
      method: 'PUT',
      body: JSON.stringify({ roots }),
    })
  }

  async function listModels() {
    return request<Array<{
      id: string
      name: string
      providerType: string
      baseUrl: string | null
      model: string
      enabled: boolean
    }>>('/api/models')
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

  async function listUsage(days = 7) {
    return request<{ days: UsageDay[] }>(`/api/usage?days=${days}`)
  }

  async function listProjects() {
    return request<ProjectRow[]>('/api/projects')
  }

  async function getProject(id: string) {
    return request<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`)
  }

  async function listWorkflows() {
    return request<WorkflowSummary[]>('/api/workflows')
  }

  async function getWorkflow(id: string) {
    return request<WorkflowSummary>(`/api/workflows/${encodeURIComponent(id)}`)
  }

  async function listRecordings() {
    return request<RecordingRow[]>('/api/recordings')
  }

  async function getRecording(id: string) {
    return request<RecordingRow & { events?: unknown }>(`/api/recordings/${encodeURIComponent(id)}`)
  }

  return {
    token: readonly(token),
    connected: readonly(connected),
    loading: readonly(loading),
    request,
    ensureLocalToken,
    connect,
    autoConnect,
    getSettings,
    setScanRoots,
    listModels,
    saveModel,
    triggerJournalScan,
    listUsage,
    listProjects,
    getProject,
    listWorkflows,
    getWorkflow,
    listRecordings,
    getRecording,
  }
}
