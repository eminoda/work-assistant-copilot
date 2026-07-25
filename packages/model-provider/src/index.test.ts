import { describe, expect, it } from 'vitest'
import { normalizeOpenAiCompatibleBaseURL } from './index.js'

describe('normalizeOpenAiCompatibleBaseURL', () => {
  it('strips trailing slash and chat/completions suffix', () => {
    expect(normalizeOpenAiCompatibleBaseURL('https://api.deepseek.com/v1/')).toBe(
      'https://api.deepseek.com/v1',
    )
    expect(
      normalizeOpenAiCompatibleBaseURL('https://api.deepseek.com/chat/completions'),
    ).toBe('https://api.deepseek.com')
  })

  it('returns undefined for empty input', () => {
    expect(normalizeOpenAiCompatibleBaseURL()).toBeUndefined()
    expect(normalizeOpenAiCompatibleBaseURL('  ')).toBeUndefined()
  })
})
