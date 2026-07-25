import type { LanguageModel } from 'ai'
import { runAgent, type AgentRunResult } from '@workcopilot/model-provider'
import type { ToolRegistry } from '@workcopilot/tool-registry'
import { createSkillContext, fromApiToolName, listSkillNames, toAiSdkTools } from './to-ai-tools.js'

export const WORKCOPILOT_AGENT_SYSTEM = `你是 WorkCopilot Agent，只服务本产品能力范围。
支持范围：
- 日报 / 月报 / 工作总结（基于 git 与本地日报材料）
- 只读查看已录制工作流、消息监控与定时相关摘要
- 说明如何使用「录制 / 文字提取 / 消息中心 / 日报」页面
不支持：写诗作文、翻译闲聊、天气股票、通用写代码/做题、点外卖购物等与上述无关的请求。
若用户问题超出范围，直接回复：当前仅支持录制、日报、消息监控与工作流相关能力，请换相关问题。
你只能通过已提供的 skill（工具）获取事实或生成日报/月报摘要，不要编造 commit、diff 或目录。
常用 skill（工具名）：
- skill_git_discover — 发现 git 仓库
- skill_git_commits — 按日期或区间查询提交（含 commit id）
- skill_git_diff — 按 commit id 获取文件与 diff
- skill_fs_listDirs — 按设置目录列出子目录
- skill_report_analyze — 根据 diff 或日报材料生成简要摘要
- skill_workflow_list / skill_notify_list — 只读查看录制工作流与消息
不要输出可执行脚本；用中文简洁回答。
不要声称可以在聊天里直接启动录制或改配置；引导用户到对应插件页面。`

export async function runWorkCopilotAgent(input: {
  model: LanguageModel
  registry: ToolRegistry
  prompt: string
  system?: string
  maxSteps?: number
}): Promise<AgentRunResult & { skillNames: string[] }> {
  const context = createSkillContext()
  const skillNames = listSkillNames(input.registry)
  const tools = toAiSdkTools(input.registry, context, skillNames)
  const result = await runAgent({
    model: input.model,
    tools,
    prompt: input.prompt,
    system: input.system ?? WORKCOPILOT_AGENT_SYSTEM,
    maxSteps: input.maxSteps ?? 8,
  })
  return {
    ...result,
    skillCalls: result.skillCalls.map((call) => ({
      ...call,
      name: fromApiToolName(call.name),
    })),
    skillNames,
  }
}
