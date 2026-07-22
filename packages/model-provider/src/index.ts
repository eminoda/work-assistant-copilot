import { generateText, streamText, type LanguageModel } from 'ai'
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

export function createLanguageModel(input: ModelConfig): LanguageModel {
  const config = modelConfigSchema.parse(input)
  if (config.provider === 'anthropic') return createAnthropic({ apiKey: config.apiKey, ...(config.baseURL ? { baseURL: config.baseURL } : {}) })(config.model)
  if (config.provider === 'azure') {
    return createAzure({
      apiKey: config.apiKey,
      ...(config.resourceName ? { resourceName: config.resourceName } : {}),
    })(config.model)
  }
  const provider = createOpenAI({
    apiKey: config.apiKey,
    ...(config.baseURL ? { baseURL: config.baseURL } : {}),
    name: config.provider,
  })
  return provider(config.model)
}

export class ModelProvider {
  constructor(private readonly model: LanguageModel) {}
  async generate(prompt: string, system?: string): Promise<string> {
    const result = await generateText({ model: this.model, prompt, ...(system ? { system } : {}) })
    return result.text
  }
  async *stream(prompt: string, system?: string): AsyncGenerator<string> {
    const result = streamText({ model: this.model, prompt, ...(system ? { system } : {}) })
    for await (const token of result.textStream) yield token
  }
}
