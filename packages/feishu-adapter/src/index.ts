import { z } from 'zod'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ToolRegistry } from '@workcopilot/tool-registry'

export const feishuConfigSchema = z.object({ appId: z.string().min(1), appSecret: z.string().min(1) })

export class FeishuAdapter {
  constructor(private readonly config: z.infer<typeof feishuConfigSchema>) {
    feishuConfigSchema.parse(config)
  }
  async tenantToken(): Promise<string> {
    const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(this.config),
    })
    const data = z.object({ tenant_access_token: z.string() }).parse(await response.json())
    return data.tenant_access_token
  }
  async appendDocument(documentId: string, content: string): Promise<void> {
    const token = await this.tenantToken()
    const response = await fetch(`https://open.feishu.cn/open-apis/docx/v1/documents/${encodeURIComponent(documentId)}/blocks/${encodeURIComponent(documentId)}/children`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ children: [{ block_type: 2, text: { elements: [{ text_run: { content } }] } }] }),
    })
    if (!response.ok) throw new Error(`Feishu export failed: ${response.status}`)
  }
}

export function registerExportTools(registry: ToolRegistry, feishu?: FeishuAdapter): void {
  registry.register({
    name: 'markdown.export', description: 'Export a report to a Markdown file',
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    outputSchema: z.object({ success: z.boolean(), path: z.string() }),
    execute: async ({ path, content }) => { const target = resolve(path); await writeFile(target, content, 'utf8'); return { success: true, path: target } },
  })
  registry.register({
    name: 'feishu.export', description: 'Export a report to a Feishu document',
    inputSchema: z.object({ documentId: z.string(), content: z.string() }),
    outputSchema: z.object({ success: z.boolean() }),
    execute: async ({ documentId, content }) => {
      if (!feishu) throw new Error('Feishu is not configured')
      await feishu.appendDocument(documentId, content)
      return { success: true }
    },
  })
}
