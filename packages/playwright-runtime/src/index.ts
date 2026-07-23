import { z } from 'zod'
import { chromium, type Browser, type Page } from 'playwright'
import { ToolRegistry } from '@workcopilot/tool-registry'
import { selectorSchema, type ElementSelector } from '@workcopilot/workflow-engine'

const successSchema = z.object({ success: z.boolean(), url: z.string().optional(), value: z.unknown().optional() })

function isClosedTargetError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /has been closed|Target page, context or browser has been closed|Browser has been closed/i.test(message)
}

export class PlaywrightRuntime {
  #browser: Browser | undefined
  #page: Page | undefined
  #launching: Promise<Browser> | undefined

  async #launchBrowser(): Promise<Browser> {
    // Default headed so desktop / local replay shows a real browser window.
    return chromium.launch({
      headless: process.env.WORKCOPILOT_HEADLESS === 'true',
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
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
      this.#launching ??= this.#launchBrowser().finally(() => {
        this.#launching = undefined
      })
      this.#browser = await this.#launching
    }

    if (!this.#page || this.#page.isClosed()) {
      this.#page = await this.#browser.newPage()
    }
    return this.#page
  }

  async withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
    try {
      return await run(await this.page())
    } catch (error) {
      if (!isClosedTargetError(error)) throw error
      // User closed the window, or a previous run left a dead handle — relaunch once.
      try { await this.#browser?.close() } catch { /* ignore */ }
      this.reset()
      return run(await this.page())
    }
  }

  locator(page: Page, target: ElementSelector) {
    // Prefer durable attributes over ephemeral copy (placeholders / marketing text).
    if (target.stableAttribute) {
      const { name, value } = target.stableAttribute
      return page.locator(`[${name}=${JSON.stringify(value)}]`)
    }
    if (target.ariaLabel) return page.getByLabel(target.ariaLabel)
    if (target.placeholder) return page.getByPlaceholder(target.placeholder)
    if (target.role) return page.getByRole(target.role as never, target.text ? { name: target.text } : {})
    if (target.text) return page.getByText(target.text, { exact: true })
    if (target.css) return page.locator(target.css)
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
    this.reset()
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
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await runtime.waitForPageReady(page, 'after browser.open')
      await runtime.logCookies('after browser.open', page)
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
        await page.context().addCookies(
          resolved!.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: cookie.domain,
            path: cookie.path || '/',
            ...(cookie.expires && cookie.expires > 0 ? { expires: cookie.expires } : {}),
            ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}),
            ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}),
            ...(cookie.sameSite ? { sameSite: cookie.sameSite as 'Strict' | 'Lax' | 'None' } : {}),
          })),
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
      const locator = runtime.locator(page, target)
      await locator.waitFor({ state: 'visible', timeout: 15_000 })
      await Promise.all([
        // Click may navigate or only fire XHR; both should settle before next step.
        page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => undefined),
        locator.click(),
      ])
      await runtime.waitForPageReady(page, 'after browser.click')
      await runtime.logCookies('after browser.click', page)
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
        const locator = runtime.locator(page, target)
        await locator.waitFor({ state: 'visible', timeout: 15_000 })
        await locator.fill(secret)
        return { success: true, url: page.url() }
      })
    },
  })
  registry.register({
    name: 'browser.extract', description: 'Extract text from an element',
    inputSchema: z.object({ target: selectorSchema }), outputSchema: successSchema,
    execute: async ({ target }) => runtime.withPage(async (page) => {
      const locator = runtime.locator(page, target)
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
