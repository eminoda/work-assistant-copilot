import { generateText, streamText, stepCountIs, type LanguageModel, type ToolSet } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createAzure } from '@ai-sdk/azure'
import { z } from 'zod'

export const modelConfigSchema = z.object({
  provider: z.enum(['openai-compatible', 'anthropic', 'azure', 'bailian', 'local']),
  model: z.string().min(1),
  baseURL: z.string().url().optional(),
  apiKey: z.string().min(1),
  resourceName: z.string().optional(),
})
export type ModelConfig = z.infer<typeof modelConfigSchema>

/** Strip accidental /chat/completions suffix so Chat Completions path is not doubled. */
export function normalizeOpenAiCompatibleBaseURL(url?: string): string | undefined {
  if (!url?.trim()) return undefined
  return url.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')
}

export function createLanguageModel(input: ModelConfig): LanguageModel {
  const config = modelConfigSchema.parse(input)
  if (config.provider === 'anthropic') {
    return createAnthropic({
      apiKey: config.apiKey,
      ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    })(config.model)
  }
  if (config.provider === 'azure') {
    return createAzure({
      apiKey: config.apiKey,
      ...(config.resourceName ? { resourceName: config.resourceName } : {}),
    })(config.model)
  }
  // DeepSeek / Bailian / local OpenAI-compatible endpoints only implement Chat Completions.
  // AI SDK 5+ defaults openai(model) to the Responses API → 404 on those hosts.
  const baseURL = normalizeOpenAiCompatibleBaseURL(config.baseURL)
  const provider = createOpenAI({
    apiKey: config.apiKey,
    ...(baseURL ? { baseURL } : {}),
    name: config.provider,
  })
  return provider.chat(config.model)
}

export class ModelProvider {
  constructor(private readonly model: LanguageModel) {}
  get languageModel() {
    return this.model
  }
  async generate(prompt: string, system?: string): Promise<string> {
    const result = await generateText({ model: this.model, prompt, ...(system ? { system } : {}) })
    return result.text
  }
  async *stream(prompt: string, system?: string): AsyncGenerator<string> {
    const result = streamText({ model: this.model, prompt, ...(system ? { system } : {}) })
    for await (const token of result.textStream) yield token
  }
}

export type AgentRunResult = {
  text: string
  steps: number
  skillCalls: Array<{ name: string; input: unknown; output?: unknown }>
}

/** Multi-step agent loop: model may call tools until done or maxSteps. */
export async function runAgent(input: {
  model: LanguageModel
  tools: ToolSet
  prompt: string
  system?: string
  maxSteps?: number
}): Promise<AgentRunResult> {
  const maxSteps = input.maxSteps ?? 8
  const result = await generateText({
    model: input.model,
    tools: input.tools,
    prompt: input.prompt,
    ...(input.system ? { system: input.system } : {}),
    stopWhen: stepCountIs(maxSteps),
  })

  const skillCalls: AgentRunResult['skillCalls'] = []
  for (const step of result.steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      const name = 'toolName' in call ? String(call.toolName) : 'unknown'
      const toolInput = 'input' in call ? call.input : undefined
      const matched = step.toolResults?.find((row) =>
        'toolCallId' in row && 'toolCallId' in call && row.toolCallId === call.toolCallId,
      )
      const output = matched && 'output' in matched ? matched.output : undefined
      skillCalls.push({ name, input: toolInput, output })
    }
  }

  return {
    text: result.text || '',
    steps: result.steps?.length ?? 0,
    skillCalls,
  }
}
