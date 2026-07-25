import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { resolve, basename, join } from 'node:path'
import { stat, readdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
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

export const commitFilesSchema = z.object({
  commitHash: z.string(),
  subject: z.string(),
  files: z.array(z.string()),
  /** Unified diff patch for the commit (may be truncated). */
  diff: z.string().default(''),
})
export type CommitFiles = z.infer<typeof commitFilesSchema>

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['-C', root, ...args], { maxBuffer: 8_000_000, windowsHide: true })
  return stdout.trim()
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
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

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'target', 'vendor',
  '.cache', 'coverage', '__pycache__', '.venv', 'venv',
])

/**
 * Recursively discover git repository roots under the given directories.
 * Stops descending once a .git directory is found at a path.
 */
export async function discoverGitRepos(
  roots: string[],
  options: { maxDepth?: number } = {},
): Promise<string[]> {
  const maxDepth = options.maxDepth ?? 4
  const found = new Set<string>()

  async function walk(dir: string, depth: number) {
    if (depth > maxDepth || found.size > 200) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (await exists(join(dir, '.git'))) {
      found.add(resolve(dir))
      return
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue
      await walk(join(dir, entry.name), depth + 1)
    }
  }

  for (const root of roots) {
    const resolved = resolve(root.trim())
    if (!resolved) continue
    try {
      const info = await stat(resolved)
      if (!info.isDirectory()) continue
    } catch {
      continue
    }
    await walk(resolved, 0)
  }
  return [...found].sort()
}

/** Commits authored on the local calendar day `date` (YYYY-MM-DD). */
export async function commitsOnDate(root: string, date: string): Promise<string[]> {
  const meta = await listCommits(root, { date })
  return meta.map((item) => item.id)
}

export const commitMetaSchema = z.object({
  id: z.string().min(1),
  subject: z.string(),
  authoredAt: z.string(),
})
export type CommitMeta = z.infer<typeof commitMetaSchema>

function nextDayStart(date: string): string {
  const untilDate = new Date(`${date}T12:00:00`)
  untilDate.setDate(untilDate.getDate() + 1)
  const y = untilDate.getFullYear()
  const m = String(untilDate.getMonth() + 1).padStart(2, '0')
  const d = String(untilDate.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}T00:00:00`
}

/**
 * List commits with id / subject / authoredAt.
 * Prefer `date` (calendar day) or `since`+`until` (ISO-ish local timestamps).
 */
export async function listCommits(
  root: string,
  options: { date?: string; since?: string; until?: string; maxCount?: number } = {},
): Promise<CommitMeta[]> {
  const args = ['log', '--pretty=%H%x09%aI%x09%s', '--no-merges']
  if (options.date) {
    args.push(`--since=${options.date}T00:00:00`, `--until=${nextDayStart(options.date)}`)
  } else {
    if (options.since) args.push(`--since=${options.since}`)
    if (options.until) args.push(`--until=${options.until}`)
  }
  if (options.maxCount && options.maxCount > 0) args.push(`-n${options.maxCount}`)
  const out = await git(root, args).catch(() => '')
  return out.split(/\r?\n/).filter(Boolean).map((line) => {
    const [id, authoredAt, ...rest] = line.split('\t')
    return commitMetaSchema.parse({
      id: id ?? '',
      authoredAt: authoredAt ?? '',
      subject: rest.join('\t') || '(no subject)',
    })
  })
}

/** Files + truncated unified diff for the given commits. */
export async function filesForCommits(
  root: string,
  hashes: string[],
  options: { maxDiffCharsPerCommit?: number; includeDiff?: boolean } = {},
): Promise<CommitFiles[]> {
  const maxDiff = options.maxDiffCharsPerCommit ?? 24_000
  const includeDiff = options.includeDiff !== false
  const results: CommitFiles[] = []
  for (const hash of hashes.slice(0, 40)) {
    const subject = await git(root, ['log', '-1', '--pretty=%s', hash]).catch(() => hash)
    const names = await git(root, [
      'show',
      '--pretty=format:',
      '--name-only',
      '--diff-filter=ACMRTUXB',
      hash,
    ]).catch(() => '')
    const files = names.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)

    let diff = ''
    if (includeDiff) {
      const patch = await git(root, [
        'show',
        '--pretty=format:',
        '--unified=3',
        '--diff-filter=ACMRTUXB',
        hash,
        '--',
        '.',
        ':(exclude)*.lock',
        ':(exclude)*-lock.json',
        ':(exclude)*.min.js',
        ':(exclude)*.map',
        ':(exclude)*.png',
        ':(exclude)*.jpg',
        ':(exclude)*.webp',
      ]).catch(() => '')
      diff = patch.length > maxDiff
        ? `${patch.slice(0, maxDiff)}\n\n…(diff truncated at ${maxDiff} chars)`
        : patch
    }

    results.push(commitFilesSchema.parse({ commitHash: hash, subject, files, diff }))
  }
  return results
}

/** Compact text blob of commit subjects + file paths + diffs for AI. */
export function summarizeCommitFilesForAi(
  projectName: string,
  root: string,
  commits: CommitFiles[],
  options: { maxFiles?: number; maxTotalDiffChars?: number } = {},
): string {
  const maxFiles = options.maxFiles ?? 120
  const maxTotalDiff = options.maxTotalDiffChars ?? 60_000
  const lines: string[] = [
    `Project: ${projectName}`,
    `Path: ${root}`,
    `Commits: ${commits.length}`,
    '',
  ]
  let fileCount = 0
  let diffBudget = maxTotalDiff
  for (const commit of commits) {
    lines.push(`### ${commit.commitHash.slice(0, 8)} — ${commit.subject}`)
    for (const file of commit.files) {
      if (fileCount >= maxFiles) {
        lines.push('- …(files truncated)')
        break
      }
      lines.push(`- ${file}`)
      fileCount += 1
    }
    if (commit.diff && diffBudget > 0) {
      const chunk = commit.diff.length > diffBudget
        ? `${commit.diff.slice(0, diffBudget)}\n…(remaining diffs omitted)`
        : commit.diff
      lines.push('', '```diff', chunk, '```', '')
      diffBudget -= chunk.length
    } else {
      lines.push('')
    }
    if (fileCount >= maxFiles && diffBudget <= 0) break
  }
  return lines.join('\n')
}

export function projectNameFromPath(root: string): string {
  return basename(resolve(root))
}
