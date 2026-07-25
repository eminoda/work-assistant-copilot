import { resolve } from 'node:path'
import { z } from 'zod'
import type { ToolRegistry, ToolContext } from '@workcopilot/tool-registry'
import {
  discoverGitRepos,
  filesForCommits,
  listCommits,
  projectNameFromPath,
} from '@workcopilot/git-analyzer'

export type SkillDeps = {
  getScanRoots: () => Promise<string[]>
  listJournals?: (from?: string, to?: string) => Promise<Array<{
    date: string
    items: Array<{ title: string; bullets: string[] }>
    rawMarkdown: string
  }>>
  getJournal?: (date: string) => Promise<{
    date: string
    items: Array<{ title: string; bullets: string[] }>
    rawMarkdown: string
  } | undefined>
  listWorkflows?: () => Promise<Array<{ id: string; name: string; intent: string }>>
  listMessages?: () => Promise<Array<{ id: string; title: string; unread: boolean; updatedAt: string }>>
  generateText?: (prompt: string, system?: string) => Promise<string>
}

async function resolveRoots(inputRoots: string[] | undefined, deps: SkillDeps): Promise<string[]> {
  if (inputRoots?.length) return inputRoots.map((item) => item.trim()).filter(Boolean)
  return deps.getScanRoots()
}

export function registerGitSkills(registry: ToolRegistry, deps: SkillDeps) {
  registry.register({
    name: 'skill.git.discover',
    description: 'Discover git repositories under one or more root directories (uses scan.roots when roots omitted).',
    inputSchema: z.object({
      roots: z.array(z.string()).optional(),
      maxDepth: z.number().int().min(0).max(12).optional(),
    }),
    outputSchema: z.object({
      repos: z.array(z.object({ path: z.string(), name: z.string() })),
    }),
    execute: async ({ roots, maxDepth }) => {
      const resolved = await resolveRoots(roots, deps)
      if (!resolved.length) return { repos: [] }
      const paths = await discoverGitRepos(resolved, { maxDepth: maxDepth ?? 4 })
      return {
        repos: paths.map((path) => ({ path, name: projectNameFromPath(path) })),
      }
    },
  })

  registry.register({
    name: 'skill.git.commits',
    description: 'List git commits for a repo path. Use date (YYYY-MM-DD) or since/until. Returns commit id, subject, authoredAt.',
    inputSchema: z.object({
      path: z.string().min(1),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      since: z.string().optional(),
      until: z.string().optional(),
      maxCount: z.number().int().positive().max(200).optional(),
    }).refine((value) => Boolean(value.date || value.since || value.until || value.maxCount), {
      message: 'Provide date, since/until, or maxCount',
    }),
    outputSchema: z.object({
      path: z.string(),
      commits: z.array(z.object({
        id: z.string(),
        subject: z.string(),
        authoredAt: z.string(),
      })),
    }),
    execute: async ({ path, date, since, until, maxCount }) => {
      const root = resolve(path)
      const commits = await listCommits(root, {
        ...(date ? { date } : {}),
        ...(since ? { since } : {}),
        ...(until ? { until } : {}),
        ...(maxCount ? { maxCount } : !date && !since && !until ? { maxCount: 20 } : {}),
      })
      return { path: root, commits }
    },
  })

  registry.register({
    name: 'skill.git.diff',
    description: 'Get changed files and unified diffs for one or more commit ids in a git repo.',
    inputSchema: z.object({
      path: z.string().min(1),
      commitIds: z.array(z.string().min(4)).min(1).max(40),
      maxChars: z.number().int().positive().max(100_000).optional(),
    }),
    outputSchema: z.object({
      path: z.string(),
      commits: z.array(z.object({
        id: z.string(),
        subject: z.string(),
        files: z.array(z.string()),
        diff: z.string(),
      })),
    }),
    execute: async ({ path, commitIds, maxChars }) => {
      const root = resolve(path)
      const rows = await filesForCommits(root, commitIds, {
        includeDiff: true,
        ...(maxChars ? { maxDiffCharsPerCommit: maxChars } : {}),
      })
      return {
        path: root,
        commits: rows.map((row) => ({
          id: row.commitHash,
          subject: row.subject,
          files: row.files,
          diff: row.diff,
        })),
      }
    },
  })
}

export type { ToolContext }
