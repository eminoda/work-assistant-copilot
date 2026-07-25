import { tool, type ToolSet } from 'ai'
import type { ToolRegistry, ToolContext } from '@workcopilot/tool-registry'
import { randomUUID } from 'node:crypto'

export const SKILL_PREFIX = 'skill.'

/** OpenAI / DeepSeek require tool names: ^[a-zA-Z0-9_-]+$ (no dots). */
export function toApiToolName(skillName: string): string {
  return skillName.replace(/\./g, '_')
}

export function fromApiToolName(apiName: string): string {
  return apiName.replace(/_/g, '.')
}

/** Convert registered skill.* tools into Vercel AI SDK tools. */
export function toAiSdkTools(
  registry: ToolRegistry,
  context: ToolContext,
  names?: string[],
): ToolSet {
  const selected = (names ?? registry.list().map((item) => item.name))
    .filter((name) => name.startsWith(SKILL_PREFIX) && registry.has(name))

  const tools: ToolSet = {}
  for (const name of selected) {
    const entry = registry.get(name)
    if (!entry) continue
    const apiName = toApiToolName(name)
    tools[apiName] = tool({
      description: entry.description,
      inputSchema: entry.inputSchema,
      execute: async (input) => registry.execute(name, input, context),
    })
  }
  return tools
}

export function createSkillContext(values = new Map<string, unknown>()): ToolContext {
  return {
    executionId: randomUUID(),
    emit: () => undefined,
    values,
  }
}

export function listSkillNames(registry: ToolRegistry): string[] {
  return registry.list().map((item) => item.name).filter((name) => name.startsWith(SKILL_PREFIX))
}
