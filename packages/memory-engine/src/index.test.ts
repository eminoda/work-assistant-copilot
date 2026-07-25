import { describe, expect, it } from 'vitest'
import {
  formatMmDd,
  mergeJournalItem,
  monthNaturalWeeks,
  weekStartMonday,
} from './index.js'

describe('journal helpers', () => {
  it('formats MM-DD', () => {
    expect(formatMmDd('2026-07-25')).toBe('07-25')
  })

  it('uses Monday as week start', () => {
    expect(weekStartMonday('2026-07-25')).toBe('2026-07-20') // Saturday → Monday 20
    expect(weekStartMonday('2026-07-20')).toBe('2026-07-20')
  })

  it('splits a month into natural weeks', () => {
    const weeks = monthNaturalWeeks(2026, 7)
    expect(weeks.length).toBeGreaterThanOrEqual(4)
    expect(weeks[0]?.weekIndex).toBe(1)
    expect(weeks.every((week) => week.dates.every((date) => date.startsWith('2026-07')))).toBe(true)
  })

  it('merges bullets under the same title', () => {
    const once = mergeJournalItem([], { title: 'Repo', description: 'A', source: 'USER' })
    const twice = mergeJournalItem(once, { title: 'Repo', description: 'B', source: 'USER' })
    expect(twice).toHaveLength(1)
    expect(twice[0]?.bullets).toEqual(['A', 'B'])
  })
})
