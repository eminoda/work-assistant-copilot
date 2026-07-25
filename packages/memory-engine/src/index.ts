import { z } from 'zod'
import type { GitSnapshot } from '@workcopilot/git-analyzer'

export const memorySourceSchema = z.enum(['USER', 'GIT', 'FILE'])
export const memoryRecordSchema = z.object({
  id: z.string(),
  date: z.string(),
  content: z.string(),
  source: memorySourceSchema,
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
})
export type MemoryRecord = z.infer<typeof memoryRecordSchema>

export const journalItemSourceSchema = z.enum(['USER', 'GIT'])
export const journalItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  bullets: z.array(z.string()),
  source: journalItemSourceSchema,
})
export type JournalItem = z.infer<typeof journalItemSchema>

export const dailyJournalSchema = z.object({
  id: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  items: z.array(journalItemSchema),
  rawMarkdown: z.string(),
  contentHash: z.string().default(''),
  aiMarkdown: z.string().default(''),
  aiContentHash: z.string().default(''),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type DailyJournal = z.infer<typeof dailyJournalSchema>

/** Stable material used to decide whether AI must re-run for a day. */
export function gitJournalMaterial(journal: Pick<DailyJournal, 'items' | 'rawMarkdown'>): string {
  const gitItems = journal.items
    .filter((item) => item.source === 'GIT')
    .map((item) => `${item.title}\n${item.bullets.join('\n')}`)
    .join('\n---\n')
  const rawGit = journal.rawMarkdown
    .split(/(?=^## )/m)
    .map((section) => section.trim())
    .filter((section) => /^## Git ·/i.test(section))
    .join('\n\n')
  return `${gitItems}\n${rawGit}`.trim()
}

export function hashGitJournalContent(journal: Pick<DailyJournal, 'items' | 'rawMarkdown'>): string {
  const material = gitJournalMaterial(journal)
  if (!material) return ''
  let hash = 0
  for (let i = 0; i < material.length; i += 1) {
    hash = ((hash << 5) - hash + material.charCodeAt(i)) | 0
  }
  return `h${(hash >>> 0).toString(16)}:${material.length}`
}

export function journalNeedsAi(journal: DailyJournal): boolean {
  const hasGit = journal.items.some((item) => item.source === 'GIT') || Boolean(gitJournalMaterial(journal))
  if (!hasGit) return false
  if (!journal.aiMarkdown.trim()) return true
  return Boolean(journal.contentHash) && journal.aiContentHash !== journal.contentHash
}

/** Detail page body: AI markdown + manual entries, same MD hierarchy. */
export function buildJournalDisplayMarkdown(journal: DailyJournal): string {
  const parts: string[] = []
  if (journal.aiMarkdown.trim()) {
    parts.push(journal.aiMarkdown.trim())
  }
  for (const item of journal.items.filter((row) => row.source === 'USER')) {
    const body = item.bullets.map((line) => line.trim()).filter(Boolean).join('\n\n')
    parts.push(body ? `## ${item.title}\n\n${body}` : `## ${item.title}`)
  }
  return parts.join('\n\n').trim()
}

/** Merge a description under an item title (append bullet if title exists). */
export function mergeJournalItem(
  items: JournalItem[],
  input: { title: string; description: string; source: 'USER' | 'GIT'; id?: string },
): JournalItem[] {
  const title = input.title.trim()
  const description = input.description.trim()
  if (!title || !description) return items
  const existing = items.find((item) => item.title === title)
  if (existing) {
    if (!existing.bullets.includes(description)) existing.bullets.push(description)
    return [...items]
  }
  return [
    ...items,
    {
      id: input.id ?? `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      title,
      bullets: [description],
      source: input.source,
    },
  ]
}

export function appendRawMarkdown(current: string, section: string): string {
  const next = section.trim()
  if (!next) return current
  return current.trim() ? `${current.trim()}\n\n${next}` : next
}

export function simplifiedJournalMarkdown(date: string, items: JournalItem[]): string {
  if (!items.length) return `# ${date}\n\n_暂无事项_\n`
  const body = items.map((item) => {
    const bullets = item.bullets.map((line) => `- ${line}`).join('\n')
    return `# ${item.title}\n\n${bullets}`
  }).join('\n\n')
  return body
}

/** Monday-start week containing the given local date (YYYY-MM-DD). */
export function weekStartMonday(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  const day = date.getDay() // 0 Sun … 6 Sat
  const offset = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + offset)
  return formatYmd(date)
}

function formatYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function formatMmDd(dateStr: string): string {
  const parts = dateStr.split('-')
  return `${parts[1]}-${parts[2]}`
}

export type NaturalWeek = {
  weekIndex: number
  start: string
  end: string
  dates: string[]
}

/** Natural weeks intersecting a calendar month (Monday start). weekIndex 1 = earliest. */
export function monthNaturalWeeks(year: number, month: number): NaturalWeek[] {
  const first = new Date(year, month - 1, 1)
  const last = new Date(year, month, 0)
  const byStart = new Map<string, string[]>()
  for (let day = 1; day <= last.getDate(); day += 1) {
    const ymd = formatYmd(new Date(year, month - 1, day))
    const start = weekStartMonday(ymd)
    const list = byStart.get(start) ?? []
    list.push(ymd)
    byStart.set(start, list)
  }
  const starts = [...byStart.keys()].sort()
  return starts.map((start, index) => {
    const dates = byStart.get(start)!
    return {
      weekIndex: index + 1,
      start,
      end: dates[dates.length - 1]!,
      dates,
    }
  })
}

export function recentMonths(count: number, from = new Date()): Array<{ year: number; month: number; label: string }> {
  const result: Array<{ year: number; month: number; label: string }> = []
  let y = from.getFullYear()
  let m = from.getMonth() + 1
  for (let i = 0; i < count; i += 1) {
    result.push({ year: y, month: m, label: `${y}-${String(m).padStart(2, '0')}` })
    m -= 1
    if (m < 1) {
      m = 12
      y -= 1
    }
  }
  return result
}

/** Local calendar date for "yesterday". */
export function localYesterday(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  return formatYmd(d)
}

export function localToday(now = new Date()): string {
  return formatYmd(new Date(now.getFullYear(), now.getMonth(), now.getDate()))
}

export function rawMemoryFromGit(snapshot: GitSnapshot): Omit<MemoryRecord, 'id'> {
  const files = snapshot.changes.map((change) => `${change.status} ${change.path}`).join('\n')
  return {
    date: snapshot.scannedAt.slice(0, 10),
    content: `Project: ${snapshot.root}\nBranch: ${snapshot.branch}\nChanges:\n${files || 'No changes'}`,
    source: 'GIT',
    metadata: { commitHash: snapshot.commitHash, changeCount: snapshot.changes.length },
    createdAt: snapshot.scannedAt,
  }
}

export function groupMemoriesByDate(records: MemoryRecord[]): Map<string, MemoryRecord[]> {
  const result = new Map<string, MemoryRecord[]>()
  for (const record of records) result.set(record.date, [...(result.get(record.date) ?? []), record])
  return result
}

export function fallbackSummary(records: MemoryRecord[], title: string): string {
  const bullets = records.map((record) => `- [${record.source}] ${record.content.split('\n')[0]}`)
  return `# ${title}\n\n${bullets.join('\n') || '- No recorded work'}\n`
}
