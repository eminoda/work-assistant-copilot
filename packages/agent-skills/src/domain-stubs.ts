import { z } from 'zod'
import type { ToolRegistry } from '@workcopilot/tool-registry'
import type { SkillDeps } from './git-skills.js'

/** Read-only stubs for 录制 / 消息 domains. */
export function registerDomainStubs(registry: ToolRegistry, deps: SkillDeps) {
  registry.register({
    name: 'skill.workflow.list',
    description: 'List recorded workflows (read-only; recording control stays in the extension).',
    inputSchema: z.object({}),
    outputSchema: z.object({
      workflows: z.array(z.object({
        id: z.string(),
        name: z.string(),
        intent: z.string(),
      })),
    }),
    execute: async () => {
      const workflows = deps.listWorkflows ? await deps.listWorkflows() : []
      return { workflows }
    },
  })

  registry.register({
    name: 'skill.notify.list',
    description: 'List notification messages (read-only).',
    inputSchema: z.object({
      limit: z.number().int().positive().max(100).optional(),
    }),
    outputSchema: z.object({
      messages: z.array(z.object({
        id: z.string(),
        title: z.string(),
        unread: z.boolean(),
        updatedAt: z.string(),
      })),
    }),
    execute: async ({ limit }) => {
      const all = deps.listMessages ? await deps.listMessages() : []
      return { messages: all.slice(0, limit ?? 30) }
    },
  })
}
