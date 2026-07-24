import { readonly, shallowRef } from 'vue'

const baseUrl = 'http://127.0.0.1:4317'

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
      if (!response.ok) throw new Error(await response.text())
      return response.status === 204 ? (undefined as T) : response.json()
    } finally {
      loading.value = false
    }
  }

  async function connect(nextToken: string) {
    const trimmed = nextToken.trim()
    if (!trimmed) throw new Error('请输入 runtime token')

    const health = await fetch(`${baseUrl}/api/health`).then(async (response) => {
      if (!response.ok) throw new Error('Runtime 未启动')
      return response.json()
    })
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

  /** On launch: if a token is saved, connect (retry while runtime is still booting). */
  async function autoConnect(retries = 12, delayMs = 500) {
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

  return {
    token: readonly(token),
    connected: readonly(connected),
    loading: readonly(loading),
    request,
    connect,
    autoConnect,
  }
}
