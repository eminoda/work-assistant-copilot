import { z } from 'zod'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { ToolRegistry } from '@workcopilot/tool-registry'
import {
  compactSelectorText,
  decodeHtmlEntities,
  flexibleTextRegex,
  selectorSchema,
  type ElementSelector,
  type SelectorScope,
} from '@workcopilot/workflow-engine'

const successSchema = z.object({
  success: z.boolean(),
  url: z.string().optional(),
  value: z.unknown().optional(),
  skipped: z.boolean().optional(),
})

function isClosedTargetError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /has been closed|Target page, context or browser has been closed|Browser has been closed/i.test(message)
}

function selectorBlob(target: ElementSelector) {
  return [target.css, target.text, target.ariaLabel, target.placeholder, target.role]
    .filter((part): part is string => Boolean(part))
    .join(' ')
}

function looksLikeBackNav(target: ElementSelector) {
  return /back|返回/i.test(selectorBlob(target))
}

function looksLikeLoginSubmit(target: ElementSelector) {
  return /login-btn|sign[\s-]?in|登\s*录|登陆|submit/i.test(selectorBlob(target))
}

function compactMatchText(text: string): string {
  return compactSelectorText(text)
}

/** Match extract page by origin + path; ignore volatile query/hash (sid, version, #mailbox). */
export function pageMatchesRecordedUrl(current: string, recorded: string): boolean {
  try {
    const live = new URL(current)
    const expected = new URL(recorded)
    if (live.origin !== expected.origin) return false
    const norm = (path: string) => path.replace(/\/+$/, '') || '/'
    const livePath = norm(live.pathname)
    const expectedPath = norm(expected.pathname)
    return livePath === expectedPath
      || livePath.startsWith(`${expectedPath}/`)
      || expectedPath.startsWith(`${livePath}/`)
  } catch {
    return current === recorded
  }
}

/**
 * Skip navigation when already on the target document.
 * - same origin + pathname (trailing slash ignored)
 * - empty / `#` / `#/` hash is compatible with any hash on that path
 *   e.g. already at .../selfcare/#/appList, next open .../selfcare/ → skip
 */
export function shouldSkipNavigation(currentUrl: string, targetUrl: string): boolean {
  try {
    const current = new URL(currentUrl)
    const target = new URL(targetUrl)
    if (current.origin !== target.origin) return false

    const pathOf = (url: URL) => url.pathname.replace(/\/+$/, '') || '/'
    if (pathOf(current) !== pathOf(target)) return false

    const normalizeHash = (hash: string) => (!hash || hash === '#' || hash === '#/' ? '' : hash)
    const currentHash = normalizeHash(current.hash)
    const targetHash = normalizeHash(target.hash)
    if (!targetHash || !currentHash) return true
    return currentHash === targetHash
  } catch {
    return currentUrl === targetUrl
  }
}

export class PlaywrightRuntime {
  #browser: Browser | undefined
  #page: Page | undefined
  #launching: Promise<Browser> | undefined
  /** When false, closed-browser errors propagate (used during workflow execution). */
  #relaunchOnClose = true
  #onDisconnected: (() => void) | undefined
  #closedNotified = false

  async #launchBrowser(): Promise<Browser> {
    // Prefer installed Google Chrome (no Chrome-for-Testing "T" badge).
    // Override with WORKCOPILOT_BROWSER_CHANNEL=chromium to use Playwright's bundle.
    const channel = process.env.WORKCOPILOT_BROWSER_CHANNEL?.trim() || 'chrome'
    return chromium.launch({
      headless: process.env.WORKCOPILOT_HEADLESS === 'true',
      ...(channel === 'chromium' ? {} : { channel }),
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    })
  }

  setRelaunchOnClose(value: boolean) {
    this.#relaunchOnClose = value
  }

  setDisconnectHandler(handler: (() => void) | undefined) {
    this.#onDisconnected = handler
  }

  isConnected() {
    return Boolean(this.#browser?.isConnected())
  }

  /** True when there is no live page (user closed the window, or never opened). */
  isPageClosed() {
    return !this.#page || this.#page.isClosed()
  }

  /** Session is gone: browser process dead, or the headed window/page was closed. */
  isSessionOpen() {
    return this.isConnected() && !this.isPageClosed()
  }

  #notifyClosed() {
    if (this.#closedNotified) return
    this.#closedNotified = true
    const handler = this.#onDisconnected
    this.reset()
    try {
      handler?.()
    } catch {
      // ignore listener errors
    }
  }

  async #shutdownFromUserClose(reason: string) {
    console.log(`[playwright] ${reason}`)
    try {
      await this.#browser?.close()
    } catch {
      // ignore
    }
    this.#notifyClosed()
  }

  #attachPageCloseListener(page: Page) {
    page.on('close', () => {
      // Closing the headed window often leaves the Chromium process alive —
      // treat page close as end-of-session and tear the browser down.
      void this.#shutdownFromUserClose('page closed — shutting down browser session')
    })
  }

  async adoptPage(page: Page, reason: string): Promise<Page> {
    this.#attachPageCloseListener(page)
    this.#page = page
    console.log(`[playwright:page] adopted (${reason}) url=${page.url()}`)
    return page
  }

  /**
   * After a click that may open _blank / window.open / SSO in a new tab,
   * switch the active page so later extract/click steps run on the destination.
   */
  async settleAfterClick(page: Page, beforeUrl: string, pagesBefore: Set<Page>, timeoutMs = 15_000): Promise<Page> {
    const context = page.context()
    const deadline = Date.now() + timeoutMs
    const isUseful = (candidate: Page) => {
      if (candidate.isClosed()) return false
      const url = candidate.url()
      return Boolean(url && /^https?:/i.test(url))
    }

    while (Date.now() < deadline) {
      for (const candidate of context.pages()) {
        if (pagesBefore.has(candidate)) continue
        if (!isUseful(candidate)) continue
        await candidate.waitForLoadState('domcontentloaded', { timeout: 10_000 }).catch(() => undefined)
        return this.adoptPage(candidate, 'new page after click')
      }

      if (!page.isClosed()) {
        const now = page.url()
        if (now && now !== beforeUrl) return page
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    console.warn(
      `[playwright:click] no navigation/popup within ${timeoutMs}ms — still at ${page.isClosed() ? '(closed)' : page.url()}`,
    )
    return page
  }

  /**
   * Scroll the extracted node into view and mark it (bold + amber highlight + floating label)
   * so the operator can see what was captured during workflow replay.
   */
  async highlightExtract(locator: Locator, value: string): Promise<void> {
    await locator.scrollIntoViewIfNeeded({ timeout: 2_000 }).catch(() => undefined)
    await locator.evaluate((element, text) => {
      const host = element as HTMLElement
      const prev = {
        outline: host.style.outline,
        outlineOffset: host.style.outlineOffset,
        backgroundColor: host.style.backgroundColor,
        fontWeight: host.style.fontWeight,
        boxShadow: host.style.boxShadow,
        transition: host.style.transition,
        color: host.style.color,
      }
      host.dataset.workcopilotExtract = '1'
      host.style.transition = 'outline 120ms ease, background-color 120ms ease, box-shadow 120ms ease'
      host.style.outline = '3px solid #ca8a04'
      host.style.outlineOffset = '3px'
      host.style.backgroundColor = 'rgba(250, 204, 21, 0.5)'
      host.style.fontWeight = '700'
      host.style.color = '#713f12'
      host.style.boxShadow = '0 0 0 6px rgba(250, 204, 21, 0.35)'

      const bannerId = 'workcopilot-extract-banner'
      document.getElementById(bannerId)?.remove()
      const banner = document.createElement('div')
      banner.id = bannerId
      const label = text.length > 96 ? `${text.slice(0, 93)}…` : text
      banner.textContent = `已提取：${label}`
      Object.assign(banner.style, {
        position: 'fixed',
        zIndex: '2147483647',
        maxWidth: 'min(480px, 90vw)',
        padding: '8px 12px',
        borderRadius: '8px',
        background: '#713f12',
        color: '#fef9c3',
        font: '600 13px/1.35 system-ui, sans-serif',
        boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
        pointerEvents: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      } as Partial<CSSStyleDeclaration>)
      const rect = host.getBoundingClientRect()
      const top = Math.max(8, rect.top - 44)
      const left = Math.min(Math.max(8, rect.left), window.innerWidth - 200)
      banner.style.top = `${top}px`
      banner.style.left = `${left}px`
      document.documentElement.appendChild(banner)

      window.setTimeout(() => banner.remove(), 5_000)
      window.setTimeout(() => {
        host.style.outline = prev.outline
        host.style.outlineOffset = prev.outlineOffset
        host.style.backgroundColor = prev.backgroundColor
        host.style.fontWeight = prev.fontWeight
        host.style.boxShadow = prev.boxShadow
        host.style.transition = prev.transition
        host.style.color = prev.color
        delete host.dataset.workcopilotExtract
      }, 8_000)
    }, value)
    // Brief pause so the highlight paints before the next step runs.
    await new Promise((resolve) => setTimeout(resolve, 600))
  }

  /** Prefer / wait for a page that matches the URL recorded with an extract step. */
  async ensurePageMatchingUrl(recordedUrl: string, timeoutMs = 15_000): Promise<Page> {
    const active = await this.page()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      for (const candidate of active.context().pages()) {
        if (candidate.isClosed()) continue
        if (!pageMatchesRecordedUrl(candidate.url(), recordedUrl)) continue
        await candidate.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => undefined)
        return this.adoptPage(candidate, `extract url ${recordedUrl}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    console.warn(
      `[playwright:extract] no open page matched recorded url=${recordedUrl}; active=${active.url()}`,
    )
    return active
  }

  /** Run a locator attempt across every open page (preferring recordedUrl matches first). */
  async withPages<T>(run: (page: Page) => Promise<T>, recordedUrl?: string): Promise<T> {
    return this.withPage(async (active) => {
      const pages = active.context().pages().filter((page) => !page.isClosed())
      const preferred = recordedUrl
        ? pages.filter((page) => pageMatchesRecordedUrl(page.url(), recordedUrl))
        : []
      const rest = pages.filter((page) => !preferred.includes(page))
      const ordered = [
        ...preferred,
        ...[active, ...rest].filter((page) => !preferred.includes(page)),
      ]
      let lastError: unknown
      for (const page of ordered) {
        try {
          const result = await run(page)
          if (page !== this.#page) await this.adoptPage(page, 'match found on other page')
          return result
        } catch (error) {
          lastError = error
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError ?? 'No page matched'))
    })
  }

  reset() {
    this.#page = undefined
    this.#browser = undefined
    this.#launching = undefined
  }

  async page(): Promise<Page> {
    if (this.#browser && !this.#browser.isConnected()) this.reset()
    if (this.#page?.isClosed()) this.#page = undefined

    if (!this.#browser) {
      this.#closedNotified = false
      this.#launching ??= this.#launchBrowser().finally(() => {
        this.#launching = undefined
      })
      this.#browser = await this.#launching
      this.#browser.on('disconnected', () => {
        this.#notifyClosed()
      })
    }

    if (!this.#page || this.#page.isClosed()) {
      this.#page = await this.#browser.newPage()
      this.#attachPageCloseListener(this.#page)
    }
    return this.#page
  }

  async withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
    try {
      return await run(await this.page())
    } catch (error) {
      if (!isClosedTargetError(error)) throw error
      if (!this.#relaunchOnClose) throw error
      // Stale handle from a previous run — relaunch once.
      try { await this.#browser?.close() } catch { /* ignore */ }
      this.reset()
      this.#closedNotified = false
      return run(await this.page())
    }
  }

  locator(page: Page, target: ElementSelector) {
    const { parents, ...self } = target
    let scope: Page | Locator = page
    if (parents?.length) {
      for (const parent of [...parents].reverse()) {
        scope = this.locateIn(scope, parent)
      }
    }
    return this.locateIn(scope, self)
  }

  /** Prefer a single visible match when selectors hit mobile+desktop duplicates. */
  async visibleLocator(page: Page, target: ElementSelector): Promise<Locator> {
    const pick = async (candidate: ElementSelector) => {
      const base = this.locator(page, candidate)
      const visible = base.filter({ visible: true })
      const visibleCount = await visible.count().catch(() => 0)
      if (visibleCount === 1) return visible
      if (visibleCount > 1) {
        console.warn(`[playwright:locator] ${visibleCount} visible matches — using first visible`)
        return visible.first()
      }
      const total = await base.count().catch(() => 0)
      if (total > 0) return base.first()
      return undefined
    }

    const primary = await pick(target)
    if (primary) return primary

    // Parent scopes from recording are often brittle (layout wrappers). Retry leaf only.
    if (target.parents?.length) {
      const { parents: _parents, ...leaf } = target
      const fallback = await pick(leaf)
      if (fallback) {
        console.warn('[playwright:locator] parent scope missed — retrying leaf selector only')
        return fallback
      }
    }

    return this.locator(page, target).first()
  }

  locateIn(scope: Page | Locator, target: SelectorScope | Omit<ElementSelector, 'parents' | 'confidence'>) {
    // Prefer durable attributes over ephemeral copy (placeholders / marketing text).
    if (target.stableAttribute) {
      const { name, value } = target.stableAttribute
      return scope.locator(`[${name}=${JSON.stringify(value)}]`)
    }
    const matchText = target.text ? compactMatchText(target.text) : undefined
    const matchRe = matchText ? flexibleTextRegex(matchText) : undefined
    // List tiles share a class — css alone is ambiguous; keep text as a filter.
    if (target.css && matchRe) {
      return scope.locator(target.css).filter({ hasText: matchRe })
    }
    if (target.css) return scope.locator(target.css)
    if (target.ariaLabel) return scope.getByLabel(target.ariaLabel)
    if (target.placeholder) return scope.getByPlaceholder(target.placeholder)
    if (target.role) {
      return scope.getByRole(target.role as never, matchText ? { name: matchRe ?? matchText } : {})
    }
    if (matchRe) return scope.getByText(matchRe)
    if ('tag' in target && target.tag) return scope.locator(target.tag)
    throw new Error('No usable selector')
  }

  async logCookies(label: string, page?: Page): Promise<void> {
    try {
      const current = page ?? this.#page
      if (!current || current.isClosed()) {
        console.log(`[playwright:cookies] ${label} skipped (no page)`)
        return
      }
      const cookies = await current.context().cookies()
      const names = cookies.map((cookie) => cookie.name)
      console.log(
        `[playwright:cookies] ${label} url=${current.url()} count=${cookies.length} names=${names.join(',') || '(none)'} hasGWSESSIONID=${names.includes('GWSESSIONID')}`,
      )
    } catch (error) {
      console.warn(`[playwright:cookies] ${label} failed`, error)
    }
  }

  /**
   * Wait until document + network settle so SPA bootstrap / Set-Cookie can finish
   * before the next workflow step. networkidle is best-effort (timeout does not fail).
   */
  async waitForPageReady(page: Page, label: string): Promise<void> {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 15_000 })
    } catch {
      console.warn(`[playwright:ready] ${label} domcontentloaded timeout url=${page.url()}`)
    }
    try {
      await page.waitForLoadState('load', { timeout: 15_000 })
    } catch {
      console.warn(`[playwright:ready] ${label} load timeout url=${page.url()}`)
    }
    try {
      // SPA often keeps a few long-lived requests; cap wait so we don't hang forever.
      await page.waitForLoadState('networkidle', { timeout: 8_000 })
      console.log(`[playwright:ready] ${label} networkidle url=${page.url()}`)
    } catch {
      console.log(`[playwright:ready] ${label} networkidle skipped (timeout) url=${page.url()}`)
    }
  }

  async close(): Promise<void> {
    try { await this.#browser?.close() } catch { /* ignore */ }
    this.#notifyClosed()
  }
}

export function registerBrowserTools(
  registry: ToolRegistry,
  runtime = new PlaywrightRuntime(),
  options: { resolveCredential?: (key: string) => Promise<string | undefined> } = {},
): PlaywrightRuntime {
  registry.register({
    name: 'browser.open', description: 'Open a URL in the automation browser',
    inputSchema: z.object({ url: z.string().url() }), outputSchema: successSchema,
    execute: async ({ url }) => runtime.withPage(async (page) => {
      const current = page.url()
      if (shouldSkipNavigation(current, url)) {
        console.log(`[playwright:open] skip — already at ${current}, next also ${url}`)
        return { success: true, url: current, skipped: true }
      }
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await runtime.waitForPageReady(page, 'after browser.open')
      await runtime.logCookies('after browser.open', page)
      return { success: true, url: page.url() }
    }),
  })
  registry.register({
    name: 'browser.waitNavigation',
    description: 'Wait for a URL change after human steps (QR / SMS). Default timeout 90s.',
    inputSchema: z.object({
      fromUrl: z.string().url(),
      expectedUrl: z.string().url().optional(),
      timeoutMs: z.number().int().positive().default(90_000),
    }),
    outputSchema: successSchema,
    execute: async ({ fromUrl, expectedUrl, timeoutMs }) => runtime.withPage(async (page) => {
      const deadline = Date.now() + timeoutMs
      const matches = (current: string) => {
        if (expectedUrl) {
          try {
            return new URL(current).href === new URL(expectedUrl).href || current.startsWith(expectedUrl)
          } catch {
            return current === expectedUrl || current.includes(expectedUrl)
          }
        }
        return current !== fromUrl
      }
      if (matches(page.url())) {
        await runtime.waitForPageReady(page, 'after browser.waitNavigation')
        return { success: true, url: page.url() }
      }
      await page.waitForURL((url) => matches(url.toString()), { timeout: Math.max(1_000, deadline - Date.now()) })
      await runtime.waitForPageReady(page, 'after browser.waitNavigation')
      await runtime.logCookies('after browser.waitNavigation', page)
      return { success: true, url: page.url() }
    }),
  })
  registry.register({
    name: 'browser.setCookies',
    description: 'Restore cookies captured during recording to rebuild login/session state',
    inputSchema: z.object({
      url: z.string().url().optional(),
      cookies: z.array(z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string().default('/'),
        expires: z.number().optional(),
        httpOnly: z.boolean().optional(),
        secure: z.boolean().optional(),
        sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
      })).optional(),
      credentialKey: z.string().optional(),
    }).refine((value) => Boolean(value.cookies?.length || value.credentialKey)),
    outputSchema: successSchema,
    execute: async ({ url, cookies, credentialKey }, context) => {
      let resolved = cookies
      if ((!resolved || resolved.length === 0) && credentialKey) {
        let raw = context.values.get(`credential:${credentialKey}`)
        if (typeof raw !== 'string' && options.resolveCredential) {
          raw = await options.resolveCredential(credentialKey)
          if (typeof raw === 'string') context.values.set(`credential:${credentialKey}`, raw)
        }
        if (typeof raw !== 'string') {
          throw new Error(`Cookie credential missing: ${credentialKey}`)
        }
        resolved = z.array(z.object({
          name: z.string(),
          value: z.string(),
          domain: z.string(),
          path: z.string().default('/'),
          expires: z.number().optional(),
          httpOnly: z.boolean().optional(),
          secure: z.boolean().optional(),
          sameSite: z.enum(['Strict', 'Lax', 'None']).optional(),
        })).parse(JSON.parse(raw))
      }
      if (!resolved?.length) throw new Error('No cookies to restore')
      console.log(
        `[playwright:cookies] setCookies credentialKey=${credentialKey ?? '(inline)'} injecting=${resolved.map((cookie) => cookie.name).join(',')}`,
      )
      return runtime.withPage(async (page) => {
        // Playwright requires either `url` OR (`domain` + `path`) — not a mix that confuses path inference.
        // Prefer domain+path from the saved jar so path stays `/` even when homeUrl includes `/selfcare/#/...`.
        const payload = resolved!.map((cookie) => {
          const domain = cookie.domain.replace(/^\./, '')
          const sameSite = cookie.sameSite as 'Strict' | 'Lax' | 'None' | undefined
          const secure = sameSite === 'None' ? true : Boolean(cookie.secure)
          return {
            name: cookie.name,
            value: cookie.value,
            domain,
            path: cookie.path && cookie.path.length > 0 ? cookie.path : '/',
            ...(typeof cookie.expires === 'number' && cookie.expires > 0 ? { expires: cookie.expires } : {}),
            httpOnly: Boolean(cookie.httpOnly),
            secure,
            ...(sameSite ? { sameSite } : {}),
          }
        })
        await page.context().addCookies(payload)
        const probeOrigin = (() => {
          try {
            return url ? `${new URL(url).origin}/` : `https://${payload[0]!.domain}/`
          } catch {
            return `https://${payload[0]!.domain}/`
          }
        })()
        const stored = await page.context().cookies(probeOrigin)
        console.log(
          `[playwright:cookies] after addCookies origin=${probeOrigin} stored=${stored.map((cookie) => cookie.name).join(',') || '(none)'}`,
        )
        await runtime.logCookies('after browser.setCookies', page)
        return { success: true, url: page.url() || url }
      })
    },
  })
  registry.register({
    name: 'browser.click', description: 'Click an element using a resilient selector',
    inputSchema: z.object({ target: selectorSchema }), outputSchema: successSchema,
    execute: async ({ target }) => runtime.withPage(async (page) => {
      // Opening action=enterprise often already shows the form; recorded「返回」would leave it.
      if (looksLikeBackNav(target)) {
        const userVisible = await page.getByPlaceholder(/用户名|账号|邮箱|手机号|username|account/i).first()
          .isVisible().catch(() => false)
        const passVisible = await page.getByPlaceholder(/密码|password/i).first()
          .isVisible().catch(() => false)
        if (userVisible && passVisible) {
          console.log('[playwright:click] skip back — username/password fields already visible')
          return { success: true, url: page.url(), skipped: true }
        }
      }

      const locator = await runtime.visibleLocator(page, target)
      await locator.waitFor({ state: 'visible', timeout: 15_000 })
      const beforeUrl = page.url()
      const pagesBefore = new Set(page.context().pages())
      const popupPromise = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null)

      await locator.click({ timeout: 15_000 })

      const popup = await popupPromise
      let active = page
      if (popup && !popup.isClosed()) {
        const popupDeadline = Date.now() + 15_000
        while (Date.now() < popupDeadline && !popup.isClosed() && !/^https?:/i.test(popup.url())) {
          await new Promise((resolve) => setTimeout(resolve, 200))
        }
        if (!popup.isClosed() && /^https?:/i.test(popup.url())) {
          active = await runtime.adoptPage(popup, 'popup after click')
        } else {
          active = await runtime.settleAfterClick(page, beforeUrl, pagesBefore, 10_000)
        }
      } else {
        active = await runtime.settleAfterClick(page, beforeUrl, pagesBefore, 15_000)
      }

      await runtime.waitForPageReady(active, 'after browser.click')
      await runtime.logCookies('after browser.click', active)
      console.log(`[playwright:click] settled url=${active.url()} (before=${beforeUrl})`)

      if (looksLikeLoginSubmit(target)) {
        try {
          await active.waitForURL((url) => !/\/login(\/|$|\?|#)/i.test(url.href), { timeout: 25_000 })
          await runtime.waitForPageReady(active, 'after login navigation')
          await runtime.logCookies('after login navigation', active)
        } catch {
          throw new Error(
            `登录点击后仍停留在登录页（${active.url()}，点击前 ${beforeUrl}）。请检查账号密码，或页面是否有验证码/协议勾选。`,
          )
        }
      }

      return { success: true, url: active.url() }
    }),
  })
  registry.register({
    name: 'browser.input', description: 'Fill an input using a value or resolved credential',
    inputSchema: z.object({ target: selectorSchema, value: z.string().optional(), credentialKey: z.string().optional() }).refine((v) => Boolean(v.value ?? v.credentialKey)),
    outputSchema: successSchema,
    execute: async ({ target, value, credentialKey }, context) => {
      let resolved = value ?? (credentialKey ? context.values.get(`credential:${credentialKey}`) : undefined)
      if (typeof resolved !== 'string' && credentialKey && options.resolveCredential) {
        resolved = await options.resolveCredential(credentialKey)
        if (typeof resolved === 'string') context.values.set(`credential:${credentialKey}`, resolved)
      }
      if (typeof resolved !== 'string') {
        throw new Error(
          credentialKey
            ? `Credential not saved: ${credentialKey}. Enter it after recording in the extension.`
            : 'Input value missing',
        )
      }
      const secret = resolved
      return runtime.withPage(async (page) => {
        const locator = await runtime.visibleLocator(page, target)
        await locator.waitFor({ state: 'visible', timeout: 15_000 })
        await locator.click({ timeout: 5_000 }).catch(() => undefined)
        await locator.fill('')
        await locator.fill(secret)
        // Vue / React controlled inputs often need native setter + input events.
        await locator.evaluate((element, next) => {
          const el = element as HTMLInputElement | HTMLTextAreaElement
          const proto = Object.getOwnPropertyDescriptor(
            el instanceof HTMLTextAreaElement
              ? window.HTMLTextAreaElement.prototype
              : window.HTMLInputElement.prototype,
            'value',
          )
          proto?.set?.call(el, next)
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
        }, secret)
        let current = await locator.inputValue().catch(() => '')
        if (current !== secret) {
          await locator.fill('')
          await locator.pressSequentially(secret, { delay: 25 })
          current = await locator.inputValue().catch(() => '')
        }
        console.log(
          `[playwright:input] credentialKey=${credentialKey ?? '(plain)'} len=${secret.length} matched=${current === secret}`,
        )
        if (current !== secret) {
          throw new Error(`Failed to fill input (value did not stick${credentialKey ? `; key=${credentialKey}` : ''})`)
        }
        return { success: true, url: page.url() }
      })
    },
  })
  registry.register({
    name: 'browser.extract', description: 'Extract text from an element',
    inputSchema: z.object({
      target: selectorSchema,
      /** Page URL where the extract was recorded — used to pick the right tab after click/_blank. */
      url: z.string().url().optional(),
    }),
    outputSchema: successSchema,
    execute: async ({ target, url: pageUrl }) => {
      if (pageUrl) {
        await runtime.ensurePageMatchingUrl(pageUrl, 15_000)
      }
      return runtime.withPages(async (page) => {
        await runtime.waitForPageReady(page, 'before browser.extract')
        const tryRead = async (locator: Locator, timeoutMs = 5_000) => {
          await locator.waitFor({ state: 'attached', timeout: timeoutMs })
          await locator.waitFor({ state: 'visible', timeout: Math.min(2_000, timeoutMs) }).catch(() => undefined)
          const raw = await locator.innerText().catch(async () => (await locator.textContent()) ?? '')
          return decodeHtmlEntities(raw).replace(/\s+/g, ' ').trim()
        }

        const finish = async (locator: Locator, value: string) => {
          await runtime.highlightExtract(locator, value).catch((error) => {
            console.warn('[playwright:extract] highlight failed', error)
          })
          return { success: true as const, value, url: page.url() }
        }

        const describe = () => {
          const bits = [
            target.css && `css=${target.css}`,
            target.text && `text=${target.text}`,
            target.parents?.length && `parents=${target.parents.length}`,
            pageUrl && `recordedUrl=${pageUrl}`,
            `url=${page.url()}`,
          ].filter(Boolean)
          return bits.join(' ') || '(empty target)'
        }

        try {
          const locator = await runtime.visibleLocator(page, target)
          const value = await tryRead(locator)
          if (!value) throw new Error(`Extract matched an empty node (${describe()})`)
          return finish(locator, value)
        } catch (error) {
          if (!target.text) throw error
          const matchRe = flexibleTextRegex(compactMatchText(target.text))
          if (target.css) {
            try {
              const byCss = page.locator(target.css).filter({ hasText: matchRe }).first()
              const value = await tryRead(byCss)
              if (value) {
                console.warn(`[playwright:extract] fell back to css + flexible text on ${page.url()}`)
                return finish(byCss, value)
              }
            } catch {
              // continue
            }
          }
          try {
            const byText = page.getByText(matchRe).first()
            const value = await tryRead(byText)
            if (value) {
              console.warn(`[playwright:extract] fell back to flexible getByText on ${page.url()}`)
              return finish(byText, value)
            }
          } catch {
            // continue
          }
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`Extract failed (${describe()}): ${message}`)
        }
      }, pageUrl)
    },
  })
  registry.register({
    name: 'browser.snapshot', description: 'Capture basic page metadata',
    inputSchema: z.object({}), outputSchema: successSchema,
    execute: async () => runtime.withPage(async (page) => {
      await runtime.waitForPageReady(page, 'before browser.snapshot')
      return {
        success: true,
        value: { title: await page.title(), url: page.url() },
        url: page.url(),
      }
    }),
  })
  registry.register({
    name: 'browser.close', description: 'Close the automation browser',
    inputSchema: z.object({}), outputSchema: successSchema,
    execute: async () => { await runtime.close(); return { success: true } },
  })
  return runtime
}
