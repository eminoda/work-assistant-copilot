import { describe, expect, it } from 'vitest'
import {
  compactSelectorText,
  decodeHtmlEntities,
  flexibleTextRegex,
  normalizeMatchText,
} from './html-text.js'

describe('html-text', () => {
  it('decodes common and numeric HTML entities', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &quot;q&quot;')).toBe('a & b <c> "q"')
    expect(decodeHtmlEntities('co&#38;bms')).toBe('co&bms')
    expect(decodeHtmlEntities('co&#x26;bms')).toBe('co&bms')
    expect(decodeHtmlEntities('A&nbsp;B')).toBe('A\u00A0B')
    expect(decodeHtmlEntities('say&hellip;')).toBe('say\u2026')
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&')
  })

  it('normalizes nbsp and whitespace for matching', () => {
    expect(normalizeMatchText('Re:前端&nbsp;co&amp;bms')).toBe('Re:前端 co&bms')
    expect(normalizeMatchText('  a\n\tb  ')).toBe('a b')
  })

  it('builds regex that matches entity or plain forms', () => {
    const re = flexibleTextRegex('A & B <C>')
    expect(re.test('A & B <C>')).toBe(true)
    expect(re.test('A &amp; B &lt;C&gt;')).toBe(true)
    expect(re.test('A &#38; B &#60;C&#62;')).toBe(true)
  })

  it('compacts labels after entity decode', () => {
    expect(
      compactSelectorText('网易企业邮箱 &amp; 协作,后面还有很长很长很长很长的介绍文字用来触发压缩'),
    ).toBe('网易企业邮箱 & 协作')
  })
})
