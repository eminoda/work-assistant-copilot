import { z } from 'zod'

export const journalItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  bullets: z.array(z.string()),
  source: z.enum(['USER', 'GIT']),
})

export const dailyJournalSchema = z.object({
  id: z.string(),
  date: z.string(),
  items: z.array(journalItemSchema),
  rawMarkdown: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type DailyJournal = z.infer<typeof dailyJournalSchema>
export type JournalItem = z.infer<typeof journalItemSchema>
