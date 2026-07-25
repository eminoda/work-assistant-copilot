import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '@workcopilot/tool-registry'
import { WorkflowEngine } from '@workcopilot/workflow-engine'
import { createApp, EventBus, type AppServices } from './app.js'

describe('runtime API', () => {
  it('exposes an unauthenticated health endpoint and protects data', async () => {
    const services = {
      token: 'test-token', registry: new ToolRegistry(), engine: new WorkflowEngine(new ToolRegistry()),
      events: new EventBus(), browser: { close: vi.fn() }, credentials: {},
      store: {},
    } as unknown as AppServices
    const app = createApp(services)
    expect((await app.request('/api/health')).status).toBe(200)
    expect((await app.request('/api/workflows')).status).toBe(401)
  })

  it('allows Tauri desktop and Chrome extension CORS origins', async () => {
    const services = {
      token: 'test-token', registry: new ToolRegistry(), engine: new WorkflowEngine(new ToolRegistry()),
      events: new EventBus(), browser: { close: vi.fn() }, credentials: {},
      store: {},
    } as unknown as AppServices
    const app = createApp(services)
    for (const origin of [
      'http://tauri.localhost',
      'https://tauri.localhost',
      'tauri://localhost',
      'chrome-extension://abcdef',
      'http://localhost:1420',
    ]) {
      const response = await app.request('/api/health', { headers: { Origin: origin } })
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    }
  })
})
