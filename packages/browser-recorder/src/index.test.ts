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
    expect(workflow.steps[0]?.params.credentialKey).toBe('demo.password')
  })
})
