import { describe, expect, it } from 'vitest'
import { shouldSkipNavigation } from './index.js'

describe('shouldSkipNavigation', () => {
  it('skips when already on same path without hash vs with hash', () => {
    expect(
      shouldSkipNavigation(
        'https://go.sheca.com/selfcare/#/appList',
        'https://go.sheca.com/selfcare/',
      ),
    ).toBe(true)
    expect(
      shouldSkipNavigation(
        'https://go.sheca.com/selfcare/',
        'https://go.sheca.com/selfcare/#/appList',
      ),
    ).toBe(true)
  })

  it('skips exact same url', () => {
    expect(
      shouldSkipNavigation(
        'https://go.sheca.com/selfcare/#/appList',
        'https://go.sheca.com/selfcare/#/appList',
      ),
    ).toBe(true)
  })

  it('does not skip different paths', () => {
    expect(
      shouldSkipNavigation(
        'https://go.sheca.com/selfcare/#/appList',
        'https://go.sheca.com/login/index.html',
      ),
    ).toBe(false)
  })

  it('does not skip different meaningful hashes', () => {
    expect(
      shouldSkipNavigation(
        'https://go.sheca.com/selfcare/#/appList',
        'https://go.sheca.com/selfcare/#/settings',
      ),
    ).toBe(false)
  })
})
