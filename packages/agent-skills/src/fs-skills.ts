import { resolve, join } from 'node:path'
import { readdir, stat } from 'node:fs/promises'
import { z } from 'zod'
import type { ToolRegistry } from '@workcopilot/tool-registry'
import type { SkillDeps } from './git-skills.js'

const SKIP = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'target', 'vendor',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv',
])

async function listSubdirs(roots: string[], maxDepth: number): Promise<string[]> {
  const found = new Set<string>()

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || found.size > 500) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue
      const full = resolve(join(dir, entry.name))
      found.add(full)
      await walk(full, depth + 1)
    }
  }

  for (const root of roots) {
    const resolved = resolve(root.trim())
    try {
      const info = await stat(resolved)
      if (!info.isDirectory()) continue
    } catch {
      continue
    }
    found.add(resolved)
    await walk(resolved, 0)
  }
  return [...found].sort()
}

export function registerFsSkills(registry: ToolRegistry, deps: SkillDeps) {
  registry.register({
    name: 'skill.fs.listDirs',
    description: 'List directories under user roots (cross-platform; skips node_modules etc.). Omitting roots uses scan.roots.',
    inputSchema: z.object({
      roots: z.array(z.string()).optional(),
      maxDepth: z.number().int().min(0).max(12).optional(),
      platform: z.enum(['win32', 'darwin', 'linux']).optional(),
    }),
    outputSchema: z.object({
      platform: z.string(),
      dirs: z.array(z.string()),
    }),
    execute: async ({ roots, maxDepth, platform }) => {
      const resolvedRoots = roots?.length
        ? roots.map((item) => item.trim()).filter(Boolean)
        : await deps.getScanRoots()
      const dirs = resolvedRoots.length
        ? await listSubdirs(resolvedRoots, maxDepth ?? 3)
        : []
      return {
        platform: platform ?? process.platform,
        dirs,
      }
    },
  })
}
