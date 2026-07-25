import { describe, expect, it } from 'vitest'
import { classifyChatIntent } from './chatIntent'

describe('classifyChatIntent', () => {
  it('detects navigate intents for plugin pages', () => {
    expect(classifyChatIntent('开始录制登录流程').kind).toBe('navigate')
    expect(classifyChatIntent('打开消息中心').kind).toBe('navigate')
    expect(classifyChatIntent('去周报看看').kind).toBe('navigate')
    expect(classifyChatIntent('帮我文字提取一下')).toMatchObject({
      kind: 'navigate',
      target: 'record',
    })
  })

  it('allows in-scope chat intents', () => {
    expect(classifyChatIntent('帮我总结本周工作').kind).toBe('chat')
    expect(classifyChatIntent('列出已保存的工作流').kind).toBe('chat')
    expect(classifyChatIntent('有没有未读消息').kind).toBe('chat')
    expect(classifyChatIntent('你好').kind).toBe('chat')
  })

  it('rejects unrelated requests', () => {
    expect(classifyChatIntent('今天天气怎么样').kind).toBe('unsupported')
    expect(classifyChatIntent('写一首诗').kind).toBe('unsupported')
    expect(classifyChatIntent('帮我点外卖').kind).toBe('unsupported')
    expect(classifyChatIntent('随便聊聊人生').kind).toBe('unsupported')
  })
})
