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
