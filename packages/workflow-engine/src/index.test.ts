import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '@workcopilot/tool-registry'
import { WorkflowEngine } from './index.js'

describe('WorkflowEngine', () => {
  it('executes validated steps through the registry', async () => {
    const registry = new ToolRegistry().register({
      name: 'echo',
      description: 'echo',
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute: async (input) => input,
    })
    const result = await new WorkflowEngine(registry).execute({
      name: 'echo workflow', intent: 'test', version: 1,
      steps: [{ id: 'one', tool: 'echo', params: { value: 'ok' }, saveAs: 'result', timeoutMs: 1000, retries: 0, requiresConfirmation: false }],
      description: '',
    })
    expect(result.status).toBe('SUCCESS')
    expect(result.outputs.result).toEqual({ value: 'ok' })
  })
})
