import {
  commitsOnDate,
  discoverGitRepos,
  filesForCommits,
  projectNameFromPath,
} from '@workcopilot/git-analyzer'
import { localToday, localYesterday } from '@workcopilot/memory-engine'
import { createLanguageModel, ModelProvider, modelConfigSchema } from '@workcopilot/model-provider'
import type { LocalCredentialProvider } from '@workcopilot/credential-provider'
import type { WorkCopilotStore } from './store.js'

const SCAN_ROOTS_KEY = 'scan.roots'
const LAST_SCAN_DATE_KEY = 'scan.lastJournalDate'

export function parseScanRoots(raw: string | undefined): string[] {
  if (!raw?.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((item) => item.trim()).filter(Boolean)
    }
  } catch {
    // fall through — treat as newline / comma separated
  }
  return raw.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean)
}

async function resolveModel(
  store: WorkCopilotStore,
  credentials: LocalCredentialProvider,
): Promise<ModelProvider | undefined> {
  const config = await store.enabledModelProvider()
  if (!config) return undefined
  const apiKey = await credentials.get(config.credentialKey)
  if (!apiKey) return undefined
  const provider = modelConfigSchema.shape.provider.parse(config.providerType)
  return new ModelProvider(createLanguageModel({
    provider,
    model: config.model,
    apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
  }))
}

function formatYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Inclusive lookback ending at `endDate` (YYYY-MM-DD), newest first. */
export function lookbackDates(endDate: string, days: number): string[] {
  const count = Math.max(1, days)
  const cursor = new Date(`${endDate}T12:00:00`)
  const out: string[] = []
  for (let i = 0; i < count; i += 1) {
    out.push(formatYmd(cursor))
    cursor.setDate(cursor.getDate() - 1)
  }
  return out
}

export type JournalScanResult = {
  date: string
  dates: string[]
  roots: string[]
  projects: number
  withCommits: number
  itemsAdded: number
  errors: string[]
}

/**
 * Ingest git facts only. AI analysis is deferred until the user opens the day
 * (hash mismatch / missing aiMarkdown).
 */
async function ingestProjectDay(input: {
  store: WorkCopilotStore
  root: string
  name: string
  projectId: string
  date: string
  result: JournalScanResult
}) {
  const hashes = await commitsOnDate(input.root, input.date)
  if (!hashes.length) return

  input.result.withCommits += 1
  const commits = await filesForCommits(input.root, hashes, { includeDiff: true })
  const allFiles = [...new Set(commits.flatMap((item) => item.files))]
  await input.store.saveGitSnapshot({
    projectId: input.projectId,
    commitHash: hashes[0]!,
    changes: commits.map((item) => ({
      commitHash: item.commitHash,
      subject: item.subject,
      files: item.files,
      diffChars: item.diff.length,
    })),
    summary: `${hashes.length} commits on ${input.date}`,
  })

  const factMd = [
    `## Git · ${input.name} (${input.date})`,
    '',
    `Commits: ${hashes.map((hash) => `\`${hash.slice(0, 8)}\``).join(', ')}`,
    '',
    '### Files',
    ...allFiles.slice(0, 80).map((file) => `- ${file}`),
    allFiles.length > 80 ? `- …(+${allFiles.length - 80} more)` : '',
    '',
    '### Commit messages',
    ...commits.map((item) => `- ${item.subject}`),
    '',
    '### Diffs (truncated)',
    ...commits.flatMap((item) => {
      if (!item.diff) return [] as string[]
      return [
        `#### ${item.commitHash.slice(0, 8)} — ${item.subject}`,
        '',
        '```diff',
        item.diff.length > 8_000 ? `${item.diff.slice(0, 8_000)}\n…` : item.diff,
        '```',
        '',
      ]
    }),
  ].filter(Boolean).join('\n')

  await input.store.addJournalItem({
    date: input.date,
    title: input.name,
    description: `${hashes.length} 次提交，涉及 ${allFiles.length} 个文件`,
    source: 'GIT',
    rawSection: factMd,
  })
  input.result.itemsAdded += 1
}

export async function runJournalGitScan(input: {
  store: WorkCopilotStore
  credentials: LocalCredentialProvider
  /** Single day override (YYYY-MM-DD). Ignored when lookbackDays > 1. */
  date?: string
  /**
   * How many calendar days to scan ending at `endDate`.
   * Scheduled job uses 1 (yesterday only). Manual scan can use 7.
   */
  lookbackDays?: number
  /** End of lookback window. Default: yesterday for lookback=1, today when lookback>1. */
  endDate?: string
  force?: boolean
  /** @deprecated AI is no longer run during scan; kept for call-site compatibility. */
  analyzeDiff?: (text: string) => Promise<{ summary: string; bullets: string[]; raw: string }>
}): Promise<JournalScanResult> {
  const lookbackDays = Math.max(1, input.lookbackDays ?? 1)
  const endDate = input.endDate
    ?? (lookbackDays > 1 ? localToday() : (input.date ?? localYesterday()))
  const dates = lookbackDays === 1 && input.date && !input.endDate
    ? [input.date]
    : lookbackDates(endDate, lookbackDays)
  const primaryDate = dates[0] ?? localYesterday()

  const settings = await input.store.settings()
  if (!input.force && lookbackDays === 1 && settings[LAST_SCAN_DATE_KEY] === primaryDate) {
    return {
      date: primaryDate,
      dates,
      roots: parseScanRoots(settings[SCAN_ROOTS_KEY]),
      projects: 0,
      withCommits: 0,
      itemsAdded: 0,
      errors: [],
    }
  }

  const roots = parseScanRoots(settings[SCAN_ROOTS_KEY])
  const result: JournalScanResult = {
    date: primaryDate,
    dates,
    roots,
    projects: 0,
    withCommits: 0,
    itemsAdded: 0,
    errors: [],
  }
  if (!roots.length) {
    return result
  }

  const repos = await discoverGitRepos(roots)
  result.projects = repos.length
  // Model still resolved so settings/health paths stay consistent; scan itself does not call AI.
  await resolveModel(input.store, input.credentials)

  console.log(
    `[journal-scan] roots=${roots.length} repos=${repos.length} dates=${dates.join(',')} (AI deferred to day view)`,
  )

  const touched = new Set<string>()
  for (const root of repos) {
    const name = projectNameFromPath(root)
    try {
      const project = await input.store.upsertProject({ name, path: root })
      for (const day of dates) {
        await ingestProjectDay({
          store: input.store,
          root,
          name,
          projectId: project.id,
          date: day,
          result,
        })
        touched.add(day)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`${name}: ${message}`)
    }
  }

  for (const day of touched) {
    try {
      await input.store.refreshJournalContentHash(day)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      result.errors.push(`hash@${day}: ${message}`)
    }
  }

  if (lookbackDays === 1) {
    await input.store.setSetting(LAST_SCAN_DATE_KEY, primaryDate)
  }
  return result
}

export { SCAN_ROOTS_KEY }
