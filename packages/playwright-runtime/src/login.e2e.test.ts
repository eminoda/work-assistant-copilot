import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ToolRegistry } from '@workcopilot/tool-registry'
import { WorkflowEngine } from '@workcopilot/workflow-engine'
import { PlaywrightRuntime, registerBrowserTools } from './index.js'

describe('browser automation login loop', () => {
  const previousHeadless = process.env.WORKCOPILOT_HEADLESS
  process.env.WORKCOPILOT_HEADLESS = 'true'
  const runtime = new PlaywrightRuntime()
  const fixturePath = fileURLToPath(new URL('../../../tests/fixtures/login.html', import.meta.url))
  const server = createServer(async (_request, response) => {
    response.setHeader('content-type', 'text/html')
    response.end(await readFile(fixturePath, 'utf8'))
  })

  beforeAll(async () => {
    await new Promise<void>((resolveReady) => server.listen(0, '127.0.0.1', resolveReady))
  })
  afterAll(async () => {
    await runtime.close()
    await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
    if (previousHeadless === undefined) delete process.env.WORKCOPILOT_HEADLESS
    else process.env.WORKCOPILOT_HEADLESS = previousHeadless
  })

  it('replays a validated login workflow', async () => {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Fixture server did not start')
    const registry = new ToolRegistry()
    registerBrowserTools(registry, runtime)
    const result = await new WorkflowEngine(registry).execute({
      name: 'Local login',
      intent: 'browser.login',
      description: 'E2E fixture',
      version: 1,
      steps: [
        { id: 'open', tool: 'browser.open', params: { url: `http://127.0.0.1:${address.port}` }, timeoutMs: 10_000, retries: 0, requiresConfirmation: false },
        { id: 'user', tool: 'browser.input', params: { target: { ariaLabel: 'Username', confidence: 1 }, value: 'demo' }, timeoutMs: 10_000, retries: 0, requiresConfirmation: false },
        { id: 'password', tool: 'browser.input', params: { target: { ariaLabel: 'Password', confidence: 1 }, value: 'not-a-real-secret' }, timeoutMs: 10_000, retries: 0, requiresConfirmation: false },
        { id: 'login', tool: 'browser.click', params: { target: { role: 'button', text: 'Login', confidence: 1 } }, timeoutMs: 10_000, retries: 0, requiresConfirmation: false },
        { id: 'result', tool: 'browser.extract', params: { target: { ariaLabel: 'Login result', confidence: 1 } }, saveAs: 'result', timeoutMs: 10_000, retries: 0, requiresConfirmation: false },
      ],
    })
    expect(result.status).toBe('SUCCESS')
    expect(result.outputs.result).toMatchObject({ value: 'Login successful' })
  }, 20_000)
})
