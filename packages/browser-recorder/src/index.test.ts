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
      id: 'r4', name: 'Session', intent: 'browser.workflow',
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
})
