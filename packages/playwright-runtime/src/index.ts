import { z } from 'zod'
import { chromium, type Browser, type Page } from 'playwright'
import { ToolRegistry } from '@workcopilot/tool-registry'
import { selectorSchema, type ElementSelector } from '@workcopilot/workflow-engine'

const successSchema = z.object({ success: z.boolean(), url: z.string().optional(), value: z.unknown().optional() })

export class PlaywrightRuntime {
  #browser: Browser | undefined
  #page: Page | undefined

  async page(): Promise<Page> {
    this.#browser ??= await chromium.launch({ headless: process.env.WORKCOPILOT_HEADLESS !== 'false' })
    this.#page ??= await this.#browser.newPage()
    return this.#page
  }

  locator(page: Page, target: ElementSelector) {
    if (target.ariaLabel) return page.getByLabel(target.ariaLabel)
    if (target.role) return page.getByRole(target.role as never, target.text ? { name: target.text } : {})
    if (target.text) return page.getByText(target.text, { exact: true })
    if (target.placeholder) return page.getByPlaceholder(target.placeholder)
    if (target.stableAttribute) return page.locator(`[${target.stableAttribute.name}="${target.stableAttribute.value}"]`)
    if (target.css) return page.locator(target.css)
    throw new Error('No usable selector')
  }

  async close(): Promise<void> {
    await this.#browser?.close()
    this.#browser = undefined
    this.#page = undefined
  }
}

export function registerBrowserTools(registry: ToolRegistry, runtime = new PlaywrightRuntime()): PlaywrightRuntime {
  registry.register({
    name: 'browser.open', description: 'Open a URL in the automation browser',
    inputSchema: z.object({ url: z.string().url() }), outputSchema: successSchema,
    execute: async ({ url }) => { const page = await runtime.page(); await page.goto(url); return { success: true, url: page.url() } },
  })
  registry.register({
    name: 'browser.click', description: 'Click an element using a resilient selector',
    inputSchema: z.object({ target: selectorSchema }), outputSchema: successSchema,
    execute: async ({ target }) => { const page = await runtime.page(); await runtime.locator(page, target).click(); return { success: true, url: page.url() } },
  })
  registry.register({
    name: 'browser.input', description: 'Fill an input using a value or resolved credential',
    inputSchema: z.object({ target: selectorSchema, value: z.string().optional(), credentialKey: z.string().optional() }).refine((v) => Boolean(v.value ?? v.credentialKey)),
    outputSchema: successSchema,
    execute: async ({ target, value, credentialKey }, context) => {
      const resolved = value ?? context.values.get(`credential:${credentialKey}`)
      if (typeof resolved !== 'string') throw new Error(`Credential not resolved: ${credentialKey}`)
      const page = await runtime.page(); await runtime.locator(page, target).fill(resolved)
      return { success: true, url: page.url() }
    },
  })
  registry.register({
    name: 'browser.extract', description: 'Extract text from an element',
    inputSchema: z.object({ target: selectorSchema }), outputSchema: successSchema,
    execute: async ({ target }) => { const page = await runtime.page(); return { success: true, value: await runtime.locator(page, target).textContent(), url: page.url() } },
  })
  registry.register({
    name: 'browser.snapshot', description: 'Capture basic page metadata',
    inputSchema: z.object({}), outputSchema: successSchema,
    execute: async () => { const page = await runtime.page(); return { success: true, value: { title: await page.title(), url: page.url() }, url: page.url() } },
  })
  registry.register({
    name: 'browser.close', description: 'Close the automation browser',
    inputSchema: z.object({}), outputSchema: successSchema,
    execute: async () => { await runtime.close(); return { success: true } },
  })
  return runtime
}
