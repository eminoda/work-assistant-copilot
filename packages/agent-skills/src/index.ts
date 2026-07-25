import type { ToolRegistry } from '@workcopilot/tool-registry'
import { registerGitSkills, type SkillDeps } from './git-skills.js'
import { registerFsSkills } from './fs-skills.js'
import { registerReportSkills } from './report-skills.js'
import { registerDomainStubs } from './domain-stubs.js'

export type { SkillDeps }
export { REPORT_ANALYZE_SYSTEM, DAILY_GIT_ANALYZE_SYSTEM } from './report-skills.js'
export { toAiSdkTools, createSkillContext, listSkillNames, SKILL_PREFIX, toApiToolName, fromApiToolName } from './to-ai-tools.js'
export { runWorkCopilotAgent, WORKCOPILOT_AGENT_SYSTEM } from './agent.js'
export {
  classifyChatIntent,
  CHAT_UNSUPPORTED_REPLY,
  type ChatIntent,
  type ChatNavigateTarget,
} from './chat-intent.js'

export function registerAgentSkills(registry: ToolRegistry, deps: SkillDeps) {
  registerGitSkills(registry, deps)
  registerFsSkills(registry, deps)
  registerReportSkills(registry, deps)
  registerDomainStubs(registry, deps)
  return registry
}
