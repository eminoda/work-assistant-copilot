import { describe, expect, it } from 'vitest'
import { ToolRegistry } from '@workcopilot/tool-registry'
import {
  registerAgentSkills,
  listSkillNames,
  toAiSdkTools,
  createSkillContext,
  classifyChatIntent,
  toApiToolName,
  fromApiToolName,
} from './index.js'

describe('agent-skills', () => {
  it('registers skill.* names', () => {
    const registry = new ToolRegistry()
    registerAgentSkills(registry, {
      getScanRoots: async () => [],
    })
    const names = listSkillNames(registry)
    expect(names).toContain('skill.git.discover')
    expect(names).toContain('skill.git.commits')
    expect(names).toContain('skill.git.diff')
    expect(names).toContain('skill.fs.listDirs')
    expect(names).toContain('skill.report.analyze')
    expect(names).toContain('skill.workflow.list')
    expect(names).toContain('skill.notify.list')
  })

  it('skill.git.discover returns empty without roots', async () => {
    const registry = new ToolRegistry()
    registerAgentSkills(registry, { getScanRoots: async () => [] })
    const result = await registry.execute('skill.git.discover', {}, createSkillContext())
    expect(result).toEqual({ repos: [] })
  })

  it('skill.fs.listDirs reports platform', async () => {
    const registry = new ToolRegistry()
    registerAgentSkills(registry, { getScanRoots: async () => [] })
    const result = await registry.execute('skill.fs.listDirs', {}, createSkillContext()) as {
      platform: string
      dirs: string[]
    }
    expect(result.platform).toBe(process.platform)
    expect(result.dirs).toEqual([])
  })

  it('skill.report.analyze requires model', async () => {
    const registry = new ToolRegistry()
    registerAgentSkills(registry, { getScanRoots: async () => [] })
    await expect(
      registry.execute('skill.report.analyze', { mode: 'diff', text: 'diff --git a' }, createSkillContext()),
    ).rejects.toThrow(/enabled AI model/i)
  })

  it('skill.report.analyze parses model output', async () => {
    const registry = new ToolRegistry()
    registerAgentSkills(registry, {
      getScanRoots: async () => [],
      generateText: async () => '完成登录修复\n- 修复 cookie 注入\n- 缩短 click 等待',
    })
    const result = await registry.execute(
      'skill.report.analyze',
      { mode: 'diff', text: 'fake diff' },
      createSkillContext(),
    ) as { summary: string; bullets: string[] }
    expect(result.summary.length).toBeGreaterThan(0)
    expect(result.bullets.length).toBeGreaterThanOrEqual(2)
  })

  it('maps skill names to API-safe tool names', () => {
    expect(toApiToolName('skill.git.discover')).toBe('skill_git_discover')
    expect(fromApiToolName('skill_fs_listDirs')).toBe('skill.fs.listDirs')
  })

  it('builds AI SDK tool set for skills', () => {
    const registry = new ToolRegistry()
    registerAgentSkills(registry, { getScanRoots: async () => [] })
    const tools = toAiSdkTools(registry, createSkillContext())
    expect(Object.keys(tools)).toContain('skill_git_discover')
    expect(Object.keys(tools)).not.toContain('skill.git.discover')
  })

  it('classifies chat intents for guardrails', () => {
    expect(classifyChatIntent('开始录制').kind).toBe('navigate')
    expect(classifyChatIntent('帮我总结本周工作').kind).toBe('chat')
    expect(classifyChatIntent('今天天气怎么样').kind).toBe('unsupported')
  })
})
