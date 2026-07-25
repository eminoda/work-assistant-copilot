import { describe, expect, it } from 'vitest'
import { chromium } from 'playwright'
import { PlaywrightRuntime } from './index.js'

describe('parent-scoped locators', () => {
  it('disambiguates duplicate text via parent scope', async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setContent(`
      <div class="login-mobile">
        <span class="login-mobile-back-btn">返回</span>
      </div>
      <div class="login-desktop">
        <span class="login-back-btn">返回</span>
      </div>
    `)

    const runtime = new PlaywrightRuntime()
    const scoped = runtime.locator(page, {
      text: '返回',
      confidence: 0.9,
      parents: [{ tag: 'div', css: 'div.login-desktop' }],
    })
    expect(await scoped.count()).toBe(1)
    expect(await scoped.textContent()).toBe('返回')
    expect(await scoped.getAttribute('class')).toContain('login-back-btn')

    await browser.close()
  })

  it('prefers semantic css on the leaf when present', async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setContent(`
      <span class="login-mobile-back-btn">返回</span>
      <span class="login-back-btn">返回</span>
    `)

    const runtime = new PlaywrightRuntime()
    const leaf = runtime.locator(page, {
      text: '返回',
      css: 'span.login-back-btn',
      confidence: 0.9,
    })
    expect(await leaf.count()).toBe(1)
    expect(await leaf.getAttribute('class')).toContain('login-back-btn')

    await browser.close()
  })

  it('matches text whether DOM encodes ampersand as & or &amp;', async () => {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()
    await page.setContent(`
      <div class="summary-warp">
        <div class="summary">
          <span class="summary-content">Re:前端 co&amp;bms 证书补办-提测</span>
        </div>
      </div>
    `)

    const runtime = new PlaywrightRuntime()
    const leaf = runtime.locator(page, {
      text: 'Re:前端 co&bms 证书补办-提测',
      css: 'span.summary-content',
      confidence: 0.9,
      parents: [
        { tag: 'div', css: 'div.summary' },
        { tag: 'div', css: 'div.summary-warp' },
      ],
    })
    expect(await leaf.count()).toBe(1)
    expect(await leaf.innerText()).toContain('co&bms')

    await browser.close()
  })
})
