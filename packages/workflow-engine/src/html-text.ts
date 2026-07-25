/**
 * Normalize / match page text when HTML entities or special characters differ
 * between recording (decoded) and DOM source (`&amp;`, `&lt;`, nbsp, …).
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00A0',
  ensp: '\u2002',
  emsp: '\u2003',
  thinsp: '\u2009',
  zwnj: '\u200C',
  zwj: '\u200D',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  times: '\u00D7',
  divide: '\u00F7',
  middot: '\u00B7',
  bull: '\u2022',
  deg: '\u00B0',
  plusmn: '\u00B1',
  laquo: '\u00AB',
  raquo: '\u00BB',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  sbquo: '\u201A',
  bdquo: '\u201E',
  euro: '\u20AC',
  pound: '\u00A3',
  yen: '\u00A5',
  cent: '\u00A2',
  sect: '\u00A7',
  para: '\u00B6',
  iexcl: '\u00A1',
  iquest: '\u00BF',
  brvbar: '\u00A6',
  uml: '\u00A8',
  not: '\u00AC',
  shy: '\u00AD',
  macr: '\u00AF',
  acute: '\u00B4',
  cedil: '\u00B8',
  ordm: '\u00BA',
  ordf: '\u00AA',
  frac14: '\u00BC',
  frac12: '\u00BD',
  frac34: '\u00BE',
}

const ENTITY_TOKEN = /&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]*);/gi

function decodeEntityToken(match: string, body: string): string {
  if (body[0] === '#') {
    const code = body[1] === 'x' || body[1] === 'X'
      ? Number.parseInt(body.slice(2), 16)
      : Number.parseInt(body.slice(1), 10)
    if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match
    try {
      return String.fromCodePoint(code)
    } catch {
      return match
    }
  }
  return NAMED_ENTITIES[body.toLowerCase()] ?? match
}

function decodeHtmlEntitiesOnce(text: string): string {
  return text.replace(ENTITY_TOKEN, decodeEntityToken)
}

/** Decode named / numeric HTML entities (handles a few layers of double-encoding). */
export function decodeHtmlEntities(text: string): string {
  let current = text
  for (let i = 0; i < 4; i += 1) {
    const next = decodeHtmlEntitiesOnce(current)
    if (next === current) break
    current = next
  }
  return current
}

/** Collapse whitespace / nbsp so recording and live DOM compare equally. */
export function normalizeMatchText(text: string): string {
  return decodeHtmlEntities(text)
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Characters that often appear entity-encoded in HTML source or buggy text nodes. */
const FLEXIBLE_CHARS: Array<{ char: string; alt: string }> = [
  { char: '&', alt: '(?:&|&amp;|&#0*38;|&#x0*26;|\\uFF06)' },
  { char: '<', alt: '(?:<|&lt;|&#0*60;|&#x0*3[cC];)' },
  { char: '>', alt: '(?:>|&gt;|&#0*62;|&#x0*3[eE];)' },
  { char: '"', alt: '(?:"|&quot;|&#0*34;|&#x0*22;|\\u201C|\\u201D)' },
  { char: "'", alt: "(?:'|&apos;|&#0*39;|&#x0*27;|\\u2018|\\u2019)" },
  { char: '\u00A0', alt: '(?:\\u00A0|&nbsp;|&#0*160;|\\s)' },
  { char: '\u2013', alt: '(?:\\u2013|&ndash;|-)' },
  { char: '\u2014', alt: '(?:\\u2014|&mdash;|--)' },
  { char: '\u2026', alt: '(?:\\u2026|&hellip;|\\.\\.\\.)' },
  { char: '\u00A9', alt: '(?:\\u00A9|&copy;)' },
  { char: '\u00AE', alt: '(?:\\u00AE|&reg;)' },
  { char: '\u2122', alt: '(?:\\u2122|&trade;)' },
]

/**
 * Build a matcher that tolerates HTML entity forms and flexible whitespace.
 * Use with Playwright `getByText(re)` / `filter({ hasText: re })`.
 */
export function flexibleTextRegex(text: string): RegExp {
  const normalized = normalizeMatchText(text)
  let pattern = escapeRegExp(normalized)
  for (const { char, alt } of FLEXIBLE_CHARS) {
    const token = escapeRegExp(char)
    if (!token) continue
    pattern = pattern.split(token).join(alt)
  }
  pattern = pattern.replace(/\\ /g, '\\s+')
  return new RegExp(pattern)
}

/** Prefer a short complete label for matching; avoid whole-card concatenated copy. */
export function compactSelectorText(text: string): string {
  const normalized = normalizeMatchText(text)
  if (!normalized) return text
  if (normalized.length <= 40 && !/[,，]/.test(normalized)) return normalized

  const rawLines = decodeHtmlEntities(text)
    .split(/\n/)
    .map((line) => normalizeMatchText(line))
    .filter(Boolean)
  if (rawLines.length > 1 && rawLines[0] && rawLines[0].length <= 40) return rawLines[0]

  const firstSegment = normalized.split(/[,，]/)[0]?.trim()
  if (firstSegment && firstSegment.length >= 2 && firstSegment.length < normalized.length) {
    return firstSegment
  }
  return normalized
}
