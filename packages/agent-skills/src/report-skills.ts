import { z } from 'zod'
import type { ToolRegistry } from '@workcopilot/tool-registry'
import type { SkillDeps } from './git-skills.js'

export const REPORT_ANALYZE_SYSTEM = `你是 WorkCopilot 日报/月报助手。
根据用户提供的代码 diff 或日报材料，输出简洁中文工作摘要。
只依据事实，不要编造未出现的功能。
输出格式：
1) 先给 1 段不超过 120 字的 summary
2) 再输出 3-8 条短 bullet，每行一条，以 "- " 开头`

/** Strict Markdown layout for daily Git AI analysis. */
export const DAILY_GIT_ANALYZE_SYSTEM = `你是 WorkCopilot 日报助手，根据 Git 变更事实生成当日日报 Markdown。
硬性格式约束（必须遵守，不要输出任何前言/后记）：
1. 使用二级标题 ## 表示项目名（仓库/项目名称）
2. 其下使用三级标题 ### 表示功能点或改动主题
3. ### 标题后写简要正文：说明相关代码修改内容（可用短段落或 "- " 列表，2-6 句/条）
4. 可有多个 ## 项目，每个项目下可有多个 ### 功能
5. 不要使用一级标题 #
6. 不要输出 summary 段落、不要 JSON、不要代码块包裹整篇
7. 只依据提供的 commits / files / diff，不要编造未出现的功能

示例结构：
## work-assistant-copilot
### 日报详情 Markdown 统一渲染
将详情页改为统一 Markdown 展示，人工与 AI 内容结构一致。
### Git 扫库后写入 contentHash
扫描完成后对当日 Git 材料计算 hash，供按需 AI 判断是否需重新分析。`

function parseBullets(text: string): { summary: string; bullets: string[] } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const bullets = lines
    .filter((line) => /^[-*•]/.test(line) || /^\d+[.)]/.test(line))
    .map((line) => line.replace(/^[-*•]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
    .filter((line) => line.length > 1)
  const summaryLine = lines.find((line) => !/^[-*•]/.test(line) && !/^\d+[.)]/.test(line) && !/^#{1,3}\s/.test(line)) ?? ''
  const summary = (summaryLine || bullets[0] || text).replace(/\s+/g, ' ').trim().slice(0, 240)
  return {
    summary,
    bullets: [...new Set(bullets)].slice(0, 12),
  }
}

function journalToText(rows: Array<{
  date: string
  items: Array<{ title: string; bullets: string[] }>
  rawMarkdown: string
}>): string {
  return rows.map((row) => {
    const items = row.items.map((item) => `# ${item.title}\n${item.bullets.map((b) => `- ${b}`).join('\n')}`).join('\n\n')
    return `## ${row.date}\n\n${items || row.rawMarkdown || '_empty_'}`
  }).join('\n\n')
}

function normalizeDailyMarkdown(raw: string): string {
  let text = raw.trim()
  text = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/i, '').trim()
  // Promote accidental H1 to H2
  text = text.replace(/^#\s+/gm, '## ')
  return text
}

export function registerReportSkills(registry: ToolRegistry, deps: SkillDeps) {
  registry.register({
    name: 'skill.report.analyze',
    description: 'Analyze code diffs or journal content into a concise report. mode=daily returns strict H2/H3 Markdown for a single day.',
    inputSchema: z.object({
      mode: z.enum(['diff', 'journal', 'daily']),
      text: z.string().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).refine((value) => {
      if (value.mode === 'diff' || value.mode === 'daily') return Boolean(value.text?.trim())
      return Boolean(value.text?.trim() || value.date || value.from || value.to)
    }, { message: 'diff/daily need text; journal needs text or date range' }),
    outputSchema: z.object({
      summary: z.string(),
      bullets: z.array(z.string()),
      raw: z.string(),
      markdown: z.string(),
    }),
    execute: async ({ mode, text, date, from, to }) => {
      if (!deps.generateText) {
        throw new Error('skill.report.analyze requires an enabled AI model')
      }
      let body = text?.trim() ?? ''
      if (mode === 'journal' && !body) {
        if (date && deps.getJournal) {
          const one = await deps.getJournal(date)
          body = one ? journalToText([one]) : ''
        } else if (deps.listJournals) {
          const rows = await deps.listJournals(from, to)
          body = journalToText(rows)
        }
      }
      if (!body.trim()) {
        return { summary: '暂无可用内容', bullets: [], raw: '', markdown: '' }
      }

      if (mode === 'daily') {
        const prompt = `请根据以下当日 Git 变更事实，输出日报 Markdown（严格 ## 项目 / ### 功能 / 正文）：\n\n${body}`
        const raw = await deps.generateText(prompt, DAILY_GIT_ANALYZE_SYSTEM)
        const markdown = normalizeDailyMarkdown(raw)
        return {
          summary: '',
          bullets: [],
          raw: markdown,
          markdown,
        }
      }

      const prompt = mode === 'diff'
        ? `请根据以下 git diff / 变更事实，总结为日报要点：\n\n${body}`
        : `请根据以下日报材料，总结为简洁中文摘要（可按日或按月）：\n\n${body}`
      const raw = await deps.generateText(prompt, REPORT_ANALYZE_SYSTEM)
      const parsed = parseBullets(raw)
      return { ...parsed, raw, markdown: raw }
    },
  })
}
