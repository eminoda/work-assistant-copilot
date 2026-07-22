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
        ...options, headers: { authorization: `Bearer ${token.value}`, 'content-type': 'application/json', ...options.headers },
      })
      if (!response.ok) throw new Error(await response.text())
      return response.status === 204 ? undefined as T : response.json()
    } finally { loading.value = false }
  }
  async function connect(nextToken: string) {
    token.value = nextToken; localStorage.setItem('workcopilot.token', nextToken)
    connected.value = (await fetch(`${baseUrl}/api/health`).then((response) => response.json())).status === 'ok'
  }
  return { token: readonly(token), connected: readonly(connected), loading: readonly(loading), request, connect }
}
