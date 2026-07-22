import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from './index.js'

describe('ToolRegistry', () => {
  it('validates input and output and emits lifecycle events', async () => {
    const emit = vi.fn()
    const registry = new ToolRegistry().register({
      name: 'math.double',
      description: 'Doubles a number',
      inputSchema: z.object({ value: z.number() }),
      outputSchema: z.object({ value: z.number() }),
      execute: async ({ value }) => ({ value: value * 2 }),
    })
    await expect(registry.execute('math.double', { value: 2 }, {
      executionId: 'test', emit, values: new Map(),
    })).resolves.toEqual({ value: 4 })
    expect(emit).toHaveBeenCalledTimes(2)
  })
})
