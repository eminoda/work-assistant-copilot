/** Supported plugin surfaces that chat may hand off to. */
export type ChatNavigateTarget = 'record' | 'notify' | 'report'

export type ChatIntent =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'navigate'; target: ChatNavigateTarget; label: string; tip: string }
  | { kind: 'chat' }

const UNSUPPORTED_REPLY =
  '我目前只能协助「录制 / 文字提取」「日报 / 工作总结」「消息监控 / 定时任务」以及查看已保存工作流相关的事情。其它请求暂不支持，请换一个相关问题试试。'

const NAVIGATE_META: Record<ChatNavigateTarget, { label: string; tip: string }> = {
  record: {
    label: '录制',
    tip: '检测到你想使用录制或文字提取。确认后将打开录制页。',
  },
  notify: {
    label: '消息中心',
    tip: '检测到你想查看消息监控或定时任务。确认后将打开消息中心。',
  },
  report: {
    label: '日报',
    tip: '检测到你想浏览日报页面。确认后将打开日报。',
  },
}

/** Patterns that mean "open this page" rather than ask the agent. */
const NAVIGATE_PATTERNS: Array<{ target: ChatNavigateTarget; patterns: RegExp[] }> = [
  {
    target: 'record',
    patterns: [
      /开始录制/,
      /去录制/,
      /打开录制/,
      /录制页(面)?/,
      /录制(登录)?流程/,
      /录制工作流/,
      /文字提取/,
      /提取文字/,
      /抓取(元素|文字|信息)/,
      /arm\s*extract/i,
      /start\s*record/i,
    ],
  },
  {
    target: 'notify',
    patterns: [
      /打开消息(中心|监控)?/,
      /去消息(中心|监控)?/,
      /消息中心/,
      /消息监控/,
      /打开定时任务/,
      /去定时任务/,
      /通知中心/,
    ],
  },
  {
    target: 'report',
    patterns: [
      /打开周报/,
      /去周报/,
      /周报页(面)?/,
      /浏览周报/,
      /打开日报/,
      /去日报/,
      /日报页(面)?/,
      /浏览日报/,
      /查看日报/,
    ],
  },
]

/** In-scope topics the agent / skills can answer without leaving chat. */
const IN_SCOPE_PATTERNS: RegExp[] = [
  // 日报 / git / 总结
  /周报/,
  /日报/,
  /月报/,
  /工作总结/,
  /本周(做了|完成|工作)/,
  /今天(做了|完成|工作)/,
  /commit/i,
  /提交(记录|历史)?/,
  /git/i,
  /diff/i,
  /仓库/,
  /项目(目录|列表)?/,
  /扫描(目录|项目)?/,
  /总结(一下|下|本周|今天)?/,
  // 工作流只读
  /工作流/,
  /已录制/,
  /有哪些(流程|工作流)/,
  /列出.*(流程|工作流)/,
  // 消息只读（询问而非打开页面）
  /有(没有|哪些)?(未读)?消息/,
  /消息(列表|情况|状态)/,
  /通知(列表|情况)/,
  /定时任务/,
  /监控/,
  // 能力说明
  /你能(做什么|干嘛|帮我)/,
  /有什么(功能|能力)/,
  /怎么(用|使用)/,
  /帮助/,
  /help/i,
]

/** Clear out-of-scope topics (guardrail denylist). */
const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /写(一首|个)?(诗|小说|作文)/,
  /翻译/,
  /天气/,
  /股票/,
  /笑话/,
  /聊天陪[伴聊]/,
  /写代码|生成代码|debug|编程题/,
  /做题|考试|作业/,
  /订票|点外卖|购物/,
  /政治|八卦|星座/,
]

export function unsupportedReply(): string {
  return UNSUPPORTED_REPLY
}

export function navigateMeta(target: ChatNavigateTarget) {
  return NAVIGATE_META[target]
}

/**
 * Classify a user turn for chat guardrails and page hand-off.
 * Navigate intents take priority; then denylist; then allowlist; else unsupported.
 */
export function classifyChatIntent(raw: string): ChatIntent {
  const text = raw.trim()
  if (!text) return { kind: 'unsupported', reason: 'empty' }

  for (const group of NAVIGATE_PATTERNS) {
    if (group.patterns.some((re) => re.test(text))) {
      const meta = NAVIGATE_META[group.target]
      return {
        kind: 'navigate',
        target: group.target,
        label: meta.label,
        tip: meta.tip,
      }
    }
  }

  if (OUT_OF_SCOPE_PATTERNS.some((re) => re.test(text))) {
    return { kind: 'unsupported', reason: 'denylist' }
  }

  if (IN_SCOPE_PATTERNS.some((re) => re.test(text))) {
    return { kind: 'chat' }
  }

  // Short capability probes / greetings → chat (agent will explain scope)
  if (/^(你好|嗨|hi|hello|在吗|谢谢)[!！。.~]*$/i.test(text)) {
    return { kind: 'chat' }
  }

  return { kind: 'unsupported', reason: 'unrelated' }
}
