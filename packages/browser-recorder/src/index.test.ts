import { describe, expect, it } from 'vitest'
import { recordingToWorkflow } from './index.js'

describe('recordingToWorkflow', () => {
  it('never embeds password values', () => {
    const workflow = recordingToWorkflow({
      id: 'r1', name: 'Login', intent: 'browser.login',
      events: [{
        id: 'e1', type: 'input', url: 'https://example.test',
        timestamp: new Date().toISOString(), credentialKey: 'demo.password',
        element: { tag: 'input', attributes: { type: 'password' }, selector: { placeholder: 'Password', confidence: 0.9 } },
      }],
    })
    expect(JSON.stringify(workflow)).not.toContain('secret')
    expect(workflow.steps[1]?.params.credentialKey).toBe('demo.password')
  })

  it('prepends browser.open when navigation was not captured', () => {
    const workflow = recordingToWorkflow({
      id: 'r2', name: 'Search', intent: 'browser.workflow',
      events: [{
        id: 'e1', type: 'click', url: 'https://www.baidu.com/',
        timestamp: new Date().toISOString(),
        element: {
          tag: 'button',
          attributes: { id: 'chat-submit-button' },
          selector: { role: 'button', text: '百度一下', stableAttribute: { name: 'id', value: 'chat-submit-button' }, confidence: 0.9 },
        },
      }],
    })
    expect(workflow.steps[0]).toMatchObject({ tool: 'browser.open', params: { url: 'https://www.baidu.com/' } })
    expect(workflow.steps[1]?.tool).toBe('browser.click')
  })

  it('maps cookie snapshots to browser.setCookies', () => {
    const workflow = recordingToWorkflow({
      id: 'r4', name: 'Session', intent: 'browser.workflow', kind: 'app',
      events: [
        {
          id: 'e1', type: 'navigation', url: 'https://go.sheca.com/selfcare/',
          timestamp: new Date().toISOString(), seq: 1,
        },
        {
          id: 'e2', type: 'cookies', url: 'https://go.sheca.com/selfcare/',
          timestamp: new Date().toISOString(), seq: 2,
          cookieCredentialKey: 'go.sheca.com.session',
        },
      ],
    })
    expect(workflow.steps.map((step) => step.tool)).toEqual(['browser.open', 'browser.setCookies'])
    expect(workflow.steps[1]?.params.credentialKey).toBe('go.sheca.com.session')
  })

  it('login workflows keep hash homeUrl and omit setCookies from replay steps', () => {
    const workflow = recordingToWorkflow({
      id: 'r7', name: 'Portal login', intent: 'browser.login', kind: 'login',
      events: [
        {
          id: 'e1', type: 'navigation', url: 'https://example.test/login',
          timestamp: new Date().toISOString(), seq: 1,
        },
        {
          id: 'e2', type: 'click', url: 'https://example.test/login',
          timestamp: new Date().toISOString(), seq: 2,
          element: {
            tag: 'button',
            attributes: {},
            selector: { text: '登录', css: 'div.login-btn', confidence: 0.9 },
          },
        },
        {
          id: 'e3', type: 'navigation', url: 'https://example.test/selfcare/#/appList',
          timestamp: new Date().toISOString(), seq: 3,
        },
        {
          id: 'e4', type: 'cookies', url: 'https://example.test/selfcare/#/appList',
          timestamp: new Date().toISOString(), seq: 4,
          cookieCredentialKey: 'example.test.session',
          cookies: [
            {
              name: 'GWSESSIONID',
              value: 'abc',
              domain: 'example.test',
              path: '/',
            },
          ],
        },
      ],
    })
    expect(workflow.kind).toBe('login')
    expect(workflow.homeUrl).toBe('https://example.test/selfcare/#/appList')
    expect(workflow.steps.map((step) => step.tool)).toEqual([
      'browser.open',
      'browser.click',
    ])
    expect(workflow.steps.every((step) => step.tool !== 'browser.setCookies')).toBe(true)
  })

  it('diffCookies returns only new or changed cookies', async () => {
    const { diffCookies } = await import('./index.js')
    const baseline = [
      { name: 'acw_tc', value: 'a', domain: 'go.sheca.com', path: '/' },
      { name: 'GWSESSIONID', value: 'old', domain: 'go.sheca.com', path: '/' },
    ]
    const current = [
      { name: 'acw_tc', value: 'a', domain: 'go.sheca.com', path: '/' },
      { name: 'GWSESSIONID', value: 'new', domain: 'go.sheca.com', path: '/' },
      { name: 'extra', value: '1', domain: 'go.sheca.com', path: '/' },
    ]
    expect(diffCookies(baseline, current).map((cookie) => cookie.name).sort()).toEqual([
      'GWSESSIONID',
      'extra',
    ])
  })

  it('maps extract events to browser.extract with saveAs', () => {
    const workflow = recordingToWorkflow({
      id: 'r5', name: 'QR', intent: 'browser.workflow',
      events: [
        {
          id: 'e1', type: 'navigation', url: 'https://example.test/login',
          timestamp: new Date().toISOString(), seq: 1,
        },
        {
          id: 'e2', type: 'waitNavigation', url: 'https://example.test/login',
          fromUrl: 'https://example.test/login',
          expectedUrl: 'https://example.test/home',
          waitTimeoutMs: 90_000,
          timestamp: new Date().toISOString(), seq: 2,
        },
        {
          id: 'e3', type: 'extract', url: 'https://example.test/home',
          extractLabel: '我的bug', extractText: 'Hello',
          timestamp: new Date().toISOString(), seq: 3,
          element: {
            tag: 'div',
            attributes: {},
            selector: { css: '.bug-title', confidence: 0.9 },
          },
        },
      ],
    })
    expect(workflow.steps.map((step) => step.tool)).toEqual([
      'browser.open',
      'browser.waitNavigation',
      'browser.extract',
    ])
    expect(workflow.steps[1]?.params).toMatchObject({
      fromUrl: 'https://example.test/login',
      expectedUrl: 'https://example.test/home',
      timeoutMs: 90_000,
    })
    expect(workflow.steps[2]).toMatchObject({
      tool: 'browser.extract',
      saveAs: 'extract:我的bug',
      timeoutMs: 5_000,
      params: {
        target: { css: '.bug-title', confidence: 0.9 },
        url: 'https://example.test/home',
      },
    })
  })

  it('replays click only — skips click-caused and redirect navigations', () => {
    const workflow = recordingToWorkflow({
      id: 'r8', name: 'Open mail', intent: 'browser.app', kind: 'app',
      events: [
        {
          id: 'e1', type: 'navigation', url: 'https://go.sheca.com/selfcare/#/appList',
          navCause: 'user',
          timestamp: new Date().toISOString(), seq: 1,
        },
        {
          id: 'e2', type: 'click', url: 'https://go.sheca.com/selfcare/#/appList',
          resultUrl: 'https://go.sheca.com/api/sso/app/forward?appId=6948391825179044',
          resultTarget: 'blank',
          timestamp: new Date().toISOString(), seq: 2,
          element: {
            tag: 'div',
            attributes: {},
            selector: { text: '邮件', css: 'div.app-item', confidence: 0.9 },
          },
        },
        {
          id: 'e3', type: 'tab', tabAction: 'created',
          url: 'https://go.sheca.com/api/sso/app/forward?appId=6948391825179044',
          navCause: 'click',
          timestamp: new Date().toISOString(), seq: 3,
        },
        {
          id: 'e4', type: 'navigation',
          url: 'https://mail.example.test/inbox',
          navCause: 'redirect',
          timestamp: new Date().toISOString(), seq: 4,
        },
      ],
    })
    expect(workflow.steps.map((step) => step.tool)).toEqual(['browser.open', 'browser.click'])
    expect(workflow.steps[1]?.params).toMatchObject({
      target: { text: '邮件', css: 'div.app-item', confidence: 0.9 },
    })
  })

  it('strips help/tooltip parents without rewriting to site-specific css', () => {
    const workflow = recordingToWorkflow({
      id: 'r9', name: 'Mail via help', intent: 'browser.app', kind: 'app',
      events: [
        {
          id: 'e1', type: 'navigation', url: 'https://go.sheca.com/selfcare/#/appList',
          navCause: 'user',
          timestamp: new Date().toISOString(), seq: 1,
        },
        {
          id: 'e2', type: 'click', url: 'https://go.sheca.com/selfcare/#/appList',
          timestamp: new Date().toISOString(), seq: 2,
          element: {
            tag: 'div',
            attributes: {},
            selector: {
              text: '网易企业邮箱 可使用',
              css: 'span.paraui-v3-help',
              parents: [
                { tag: 'span', css: 'span.paraui-v3-help' },
                { tag: 'div', css: 'div.panel' },
              ],
              confidence: 0.9,
            },
          },
        },
      ],
    })
    const target = (workflow.steps[1]?.params as { target: {
      text?: string
      css?: string
      parents?: Array<{ css?: string }>
    } }).target
    expect(target.text).toBe('网易企业邮箱 可使用')
    expect(target.css).toBeUndefined()
    expect(target.parents).toEqual([{ tag: 'div', css: 'div.panel' }])
  })

  it('compacts whole-card label text for click steps', () => {
    const workflow = recordingToWorkflow({
      id: 'r10', name: 'Mail card', intent: 'browser.app', kind: 'app',
      events: [
        {
          id: 'e1', type: 'navigation', url: 'https://go.sheca.com/selfcare/#/appList',
          navCause: 'user',
          timestamp: new Date().toISOString(), seq: 1,
        },
        {
          id: 'e2', type: 'click', url: 'https://go.sheca.com/selfcare/#/appList',
          timestamp: new Date().toISOString(), seq: 2,
          element: {
            tag: 'div',
            attributes: {},
            selector: {
              text: '网易企业邮箱 可使用 网易企业邮箱,国际化标准安全证书的企业电子邮箱系统,专业反垃圾技术,极速稳定收发',
              css: 'div.app-card-wrapper',
              confidence: 0.9,
            },
          },
        },
      ],
    })
    expect(workflow.steps[1]?.params).toMatchObject({
      target: {
        text: '网易企业邮箱 可使用 网易企业邮箱',
        css: 'div.app-card-wrapper',
      },
    })
  })
})
