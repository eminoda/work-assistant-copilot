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
})
