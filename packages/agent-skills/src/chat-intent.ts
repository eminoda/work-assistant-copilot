/** Shared chat intent / guardrail helpers for WorkCopilot Agent. */

export type ChatNavigateTarget = 'record' | 'notify' | 'report'

export type ChatIntent =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'navigate'; target: ChatNavigateTarget }
  | { kind: 'chat' }

export const CHAT_UNSUPPORTED_REPLY =
  '我目前只能协助「录制 / 文字提取」「日报 / 工作总结」「消息监控 / 定时任务」以及查看已保存工作流相关的事情。其它请求暂不支持，请换一个相关问题试试。'

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

const IN_SCOPE_PATTERNS: RegExp[] = [
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
  /工作流/,
  /已录制/,
  /有哪些(流程|工作流)/,
  /列出.*(流程|工作流)/,
  /有(没有|哪些)?(未读)?消息/,
  /消息(列表|情况|状态)/,
  /通知(列表|情况)/,
  /定时任务/,
  /监控/,
  /你能(做什么|干嘛|帮我)/,
  /有什么(功能|能力)/,
  /怎么(用|使用)/,
  /帮助/,
  /help/i,
]

const OUT_OF_SCOPE_PATTERNS: RegExp[] = [
  /写(一首|个)?(诗|小说|作文)/,
  /翻译/,
  /天气/,
  /股票/,
  /笑话/,
  /聊天陪[伴聊]/,
  /写代码|生成代码|编程题/,
  /做题|考试|作业/,
  /订票|点外卖|购物/,
]

export function classifyChatIntent(raw: string): ChatIntent {
  const text = raw.trim()
  if (!text) return { kind: 'unsupported', reason: 'empty' }

  for (const group of NAVIGATE_PATTERNS) {
    if (group.patterns.some((re) => re.test(text))) {
      return { kind: 'navigate', target: group.target }
    }
  }

  if (OUT_OF_SCOPE_PATTERNS.some((re) => re.test(text))) {
    return { kind: 'unsupported', reason: 'denylist' }
  }

  if (IN_SCOPE_PATTERNS.some((re) => re.test(text))) {
    return { kind: 'chat' }
  }

  if (/^(你好|嗨|hi|hello|在吗|谢谢)[!！。.~]*$/i.test(text)) {
    return { kind: 'chat' }
  }

  return { kind: 'unsupported', reason: 'unrelated' }
}
