import { z } from 'zod'

export const toolErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().default(false),
})

export type ToolContext = {
  executionId: string
  signal?: AbortSignal
  emit: (event: AgentEvent) => void
  values: Map<string, unknown>
}

export const agentEventSchema = z.object({
  type: z.enum([
    'tool.started',
    'tool.progress',
    'tool.finished',
    'workflow.started',
    'workflow.finished',
    'workflow.failed',
    'human.confirm.required',
  ]),
  executionId: z.string(),
  tool: z.string().optional(),
  message: z.string(),
  timestamp: z.string().datetime(),
  data: z.unknown().optional(),
})
export type AgentEvent = z.infer<typeof agentEventSchema>

export interface Tool<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: z.ZodType<TInput>
  outputSchema: z.ZodType<TOutput>
  execute(input: TInput, context: ToolContext): Promise<TOutput>
}

export class ToolRegistry {
  readonly #tools = new Map<string, Tool>()

  register<TInput, TOutput>(tool: Tool<TInput, TOutput>): this {
    if (this.#tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`)
    this.#tools.set(tool.name, tool as Tool)
    return this
  }

  has(name: string): boolean {
    return this.#tools.has(name)
  }

  list(): Array<Pick<Tool, 'name' | 'description'>> {
    return [...this.#tools.values()].map(({ name, description }) => ({ name, description }))
  }

  async execute(name: string, input: unknown, context: ToolContext): Promise<unknown> {
    const tool = this.#tools.get(name)
    if (!tool) throw new Error(`Unknown tool: ${name}`)
    const parsedInput = tool.inputSchema.parse(input)
    context.emit({
      type: 'tool.started',
      executionId: context.executionId,
      tool: name,
      message: `Starting ${name}`,
      timestamp: new Date().toISOString(),
    })
    try {
      const result = tool.outputSchema.parse(await tool.execute(parsedInput, context))
      context.emit({
        type: 'tool.finished',
        executionId: context.executionId,
        tool: name,
        message: `Finished ${name}`,
        timestamp: new Date().toISOString(),
        data: result,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      context.emit({
        type: 'workflow.failed',
        executionId: context.executionId,
        tool: name,
        message,
        timestamp: new Date().toISOString(),
      })
      throw error
    }
  }
}
