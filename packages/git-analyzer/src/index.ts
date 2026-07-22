import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve } from 'node:path'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
const exec = promisify(execFile)

export const gitChangeSchema = z.object({
  status: z.string(),
  path: z.string(),
})
export const gitSnapshotSchema = z.object({
  root: z.string(),
  branch: z.string(),
  commitHash: z.string(),
  changes: z.array(gitChangeSchema),
  diff: z.string(),
  scannedAt: z.string().datetime(),
})
export type GitSnapshot = z.infer<typeof gitSnapshotSchema>

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', root, ...args], { maxBuffer: 2_000_000, windowsHide: true })
  return stdout.trim()
}

export async function scanGitRepository(inputPath: string): Promise<GitSnapshot> {
  const root = resolve(inputPath)
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('Workspace must be a directory')
  const top = await git(root, ['rev-parse', '--show-toplevel'])
  if (resolve(top) !== root && !root.startsWith(resolve(top))) throw new Error('Invalid git root')
  const [branch, commitHash, status, unstaged, staged] = await Promise.all([
    git(root, ['branch', '--show-current']),
    git(root, ['rev-parse', 'HEAD']).catch(() => 'unborn'),
    git(root, ['status', '--porcelain=v1']),
    git(root, ['diff', '--', '.', ':(exclude)*.lock']),
    git(root, ['diff', '--cached', '--', '.', ':(exclude)*.lock']),
  ])
  const changes = status.split(/\r?\n/).filter(Boolean).map((line) => ({
    status: line.slice(0, 2).trim() || 'M',
    path: line.slice(3),
  }))
  return gitSnapshotSchema.parse({
    root, branch: branch || 'detached', commitHash, changes,
    diff: [unstaged, staged].filter(Boolean).join('\n'), scannedAt: new Date().toISOString(),
  })
}
