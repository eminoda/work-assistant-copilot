import { z } from 'zod'
import { chromium, type Browser, type Locator, type Page } from 'playwright'
import { ToolRegistry } from '@workcopilot/tool-registry'
import { selectorSchema, type ElementSelector, type SelectorScope } from '@workcopilot/workflow-engine'

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
    // Default headed so desktop / local replay shows a real browser window.
    return chromium.launch({
      headless: process.env.WORKCOPILOT_HEADLESS === 'true',
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
    const base = this.locator(page, target)
    const visible = base.filter({ visible: true })
    const visibleCount = await visible.count().catch(() => 0)
    if (visibleCount === 1) return visible
    if (visibleCount > 1) {
      console.warn(`[playwright:locator] ${visibleCount} visible matches — using first visible`)
      return visible.first()
    }
    return base.first()
  }

  locateIn(scope: Page | Locator, target: SelectorScope | Omit<ElementSelector, 'parents' | 'confidence'>) {
    // Prefer durable attributes over ephemeral copy (placeholders / marketing text).
    if (target.stableAttribute) {
      const { name, value } = target.stableAttribute
      return scope.locator(`[${name}=${JSON.stringify(value)}]`)
    }
    if (target.css) return scope.locator(target.css)
    if (target.ariaLabel) return scope.getByLabel(target.ariaLabel)
    if (target.placeholder) return scope.getByPlaceholder(target.placeholder)
    if (target.role) return scope.getByRole(target.role as never, target.text ? { name: target.text } : {})
    if (target.text) return scope.getByText(target.text, { exact: true })
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
      await Promise.all([
        page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined),
        locator.click(),
      ])
      await runtime.waitForPageReady(page, 'after browser.click')
      await runtime.logCookies('after browser.click', page)

      if (looksLikeLoginSubmit(target)) {
        try {
          await page.waitForURL((url) => !/\/login(\/|$|\?|#)/i.test(url.href), { timeout: 25_000 })
          await runtime.waitForPageReady(page, 'after login navigation')
          await runtime.logCookies('after login navigation', page)
        } catch {
          throw new Error(
            `登录点击后仍停留在登录页（${page.url()}，点击前 ${beforeUrl}）。请检查账号密码，或页面是否有验证码/协议勾选。`,
          )
        }
      }

      return { success: true, url: page.url() }
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
    inputSchema: z.object({ target: selectorSchema }), outputSchema: successSchema,
    execute: async ({ target }) => runtime.withPage(async (page) => {
      const locator = await runtime.visibleLocator(page, target)
      await locator.waitFor({ state: 'visible', timeout: 15_000 })
      return {
        success: true,
        value: await locator.textContent(),
        url: page.url(),
      }
    }),
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
