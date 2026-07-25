import { describe, expect, it } from 'vitest'
import { listCommits } from './index.js'

describe('listCommits parsing', () => {
  it('exports listCommits', () => {
    expect(typeof listCommits).toBe('function')
  })
})
