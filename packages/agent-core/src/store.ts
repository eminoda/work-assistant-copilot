import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { workflowSchema, workflowStepSchema, type ExecutionResult, type Workflow } from '@workcopilot/workflow-engine'
import { memoryRecordSchema, type MemoryRecord, dailyJournalSchema, type DailyJournal, mergeJournalItem, appendRawMarkdown } from '@workcopilot/memory-engine'
import { workCopilotHome } from '@workcopilot/credential-provider'
import { initialSchemaStatements } from './migrations.js'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'

const packedStepsSchema = z.object({
  kind: z.enum(['login', 'app']).optional(),
  homeUrl: z.string().url().optional(),
  prerequisiteWorkflowId: z.string().min(1).optional(),
  steps: z.array(workflowStepSchema),
})

function packWorkflowSteps(workflow: Workflow): Prisma.InputJsonValue {
  return {
    kind: workflow.kind,
    ...(workflow.homeUrl ? { homeUrl: workflow.homeUrl } : {}),
    ...(workflow.prerequisiteWorkflowId ? { prerequisiteWorkflowId: workflow.prerequisiteWorkflowId } : {}),
    steps: workflow.steps,
  } as Prisma.InputJsonValue
}

function unpackWorkflowRow(row: {
  id: string
  name: string
  intent: string
  description: string
  steps: unknown
  createdAt?: Date | string
  updatedAt?: Date | string
}): Workflow & { id: string } {
  const createdAt = row.createdAt instanceof Date
    ? row.createdAt.toISOString()
    : typeof row.createdAt === 'string'
      ? new Date(row.createdAt).toISOString()
      : undefined
  const updatedAt = row.updatedAt instanceof Date
    ? row.updatedAt.toISOString()
    : typeof row.updatedAt === 'string'
      ? new Date(row.updatedAt).toISOString()
      : undefined
  const packed = packedStepsSchema.safeParse(row.steps)
  if (packed.success) {
    return workflowSchema.parse({
      id: row.id,
      name: row.name,
      intent: row.intent,
      description: row.description,
      version: 1,
      kind: packed.data.kind ?? (row.intent.includes('login') ? 'login' : 'app'),
      ...(packed.data.homeUrl ? { homeUrl: packed.data.homeUrl } : {}),
      ...(packed.data.prerequisiteWorkflowId
        ? { prerequisiteWorkflowId: packed.data.prerequisiteWorkflowId }
        : {}),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      steps: packed.data.steps,
    }) as Workflow & { id: string }
  }
  return workflowSchema.parse({
    id: row.id,
    name: row.name,
    intent: row.intent,
    description: row.description,
    version: 1,
    kind: row.intent.includes('login') ? 'login' : 'app',
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    steps: row.steps,
  }) as Workflow & { id: string }
}

export class NameConflictError extends Error {
  constructor(name: string) {
    super(`工作流名称「${name}」已存在`)
    this.name = 'NameConflictError'
  }
}

export class WorkCopilotStore {
  readonly db: PrismaClient

  constructor(db?: PrismaClient) {
    const home = workCopilotHome()
    mkdirSync(home, { recursive: true })
    const url = process.env.DATABASE_URL ?? `file:${join(home, 'workcopilot.db')}`
    this.db = db ?? new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) })
  }
  async connect() {
    await this.db.$connect()
    for (const statement of initialSchemaStatements) await this.db.$executeRawUnsafe(statement)
  }
  async close() { await this.db.$disconnect() }

  async assertWorkflowNameAvailable(name: string, excludeId?: string) {
    const trimmed = name.trim()
    if (!trimmed) return
    const rows = await this.db.workflow.findMany({ select: { id: true, name: true } })
    const clash = rows.find((row) => {
      if (excludeId && row.id === excludeId) return false
      return row.name.trim().toLowerCase() === trimmed.toLowerCase()
    })
    if (clash) throw new NameConflictError(trimmed)
  }

  async listWorkflows(): Promise<Array<Workflow & { id: string }>> {
    const rows = await this.db.workflow.findMany({ orderBy: { updatedAt: 'desc' } })
    return rows.map((row) => unpackWorkflowRow(row))
  }
  async getWorkflow(id: string): Promise<(Workflow & { id: string }) | undefined> {
    const row = await this.db.workflow.findUnique({ where: { id } })
    if (!row) return undefined
    return unpackWorkflowRow(row)
  }
  async saveWorkflow(input: Workflow): Promise<Workflow & { id: string }> {
    const workflow = workflowSchema.parse({
      ...input,
      name: input.name.trim(),
    })
    await this.assertWorkflowNameAvailable(workflow.name, workflow.id)
    const row = await this.db.workflow.create({
      data: {
        name: workflow.name,
        intent: workflow.intent,
        description: workflow.description,
        steps: packWorkflowSteps(workflow),
      },
    })
    return unpackWorkflowRow(row)
  }
  async deleteWorkflow(id: string) { await this.db.workflow.delete({ where: { id } }) }

  async renameWorkflow(id: string, name: string) {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('名称不能为空')
    const existing = await this.getWorkflow(id)
    if (!existing) throw new Error('Workflow not found')
    await this.assertWorkflowNameAvailable(trimmed, id)
    await this.db.workflow.update({ where: { id }, data: { name: trimmed } })
    return this.getWorkflow(id)
  }

  async setPrerequisiteWorkflowId(id: string, prerequisiteWorkflowId: string | null) {
    const workflow = await this.getWorkflow(id)
    if (!workflow) throw new Error('Workflow not found')
    if (prerequisiteWorkflowId) {
      if (prerequisiteWorkflowId === id) throw new Error('不能将自身设为前置工作流')
      const prerequisite = await this.getWorkflow(prerequisiteWorkflowId)
      if (!prerequisite) throw new Error('前置工作流不存在')
    }
    const next: Workflow = {
      ...workflow,
      ...(prerequisiteWorkflowId
        ? { prerequisiteWorkflowId }
        : { prerequisiteWorkflowId: undefined }),
    }
    if (!prerequisiteWorkflowId) delete (next as { prerequisiteWorkflowId?: string }).prerequisiteWorkflowId
    await this.db.workflow.update({
      where: { id },
      data: { steps: packWorkflowSteps(next) },
    })
    return this.getWorkflow(id)
  }

  async saveRecording(input: { name: string; intent: string; events: unknown[]; url?: string }) {
    return this.db.recording.create({ data: { ...input, events: input.events as Prisma.InputJsonValue } })
  }
  async saveExecution(workflowId: string, result: ExecutionResult) {
    await this.db.workflowExecution.upsert({
      where: { id: result.id },
      create: {
        id: result.id, workflowId, status: result.status, startedAt: result.startedAt,
        finishedAt: result.finishedAt ?? null, result: result.outputs as Prisma.InputJsonValue,
        error: result.error ?? null, events: result.events as unknown as Prisma.InputJsonValue,
      },
      update: {
        status: result.status, finishedAt: result.finishedAt ?? null,
        result: result.outputs as Prisma.InputJsonValue, error: result.error ?? null,
        events: result.events as unknown as Prisma.InputJsonValue,
      },
    })
  }
  async getExecution(id: string) { return this.db.workflowExecution.findUnique({ where: { id } }) }

  async listProjects() { return this.db.project.findMany({ orderBy: { createdAt: 'desc' } }) }
  async createProject(input: { name: string; path: string; gitUrl?: string }) { return this.db.project.create({ data: input }) }
  async getProject(id: string) { return this.db.project.findUnique({ where: { id } }) }

  async saveMemory(input: Omit<MemoryRecord, 'id'>): Promise<MemoryRecord> {
    const row = await this.db.dailyMemory.create({
      data: { date: input.date, content: input.content, source: input.source, metadata: input.metadata as Prisma.InputJsonValue },
    })
    return memoryRecordSchema.parse({ ...row, createdAt: row.createdAt.toISOString() })
  }
  async listMemories(from?: string, to?: string): Promise<MemoryRecord[]> {
    const rows = await this.db.dailyMemory.findMany({
      ...(from || to ? { where: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } } : {}),
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    })
    return rows.map((row) => memoryRecordSchema.parse({ ...row, createdAt: row.createdAt.toISOString() }))
  }
  async saveReport(input: { type: string; startDate: string; endDate: string; content: string }) {
    return this.db.report.create({ data: input })
  }

  private parseJournalRow(row: {
    id: string
    date: string
    items: string | unknown
    rawMarkdown: string
    createdAt: string | Date
    updatedAt: string | Date
  }): DailyJournal {
    const itemsRaw = typeof row.items === 'string' ? JSON.parse(row.items) : row.items
    const toIso = (value: string | Date) => (value instanceof Date ? value.toISOString() : new Date(value).toISOString())
    return dailyJournalSchema.parse({
      id: row.id,
      date: row.date,
      items: itemsRaw,
      rawMarkdown: row.rawMarkdown ?? '',
      createdAt: toIso(row.createdAt),
      updatedAt: toIso(row.updatedAt),
    })
  }

  async listJournals(from?: string, to?: string): Promise<DailyJournal[]> {
    const rows = await this.db.$queryRawUnsafe<Array<{
      id: string
      date: string
      items: string
      rawMarkdown: string
      createdAt: string
      updatedAt: string
    }>>(
      from || to
        ? `SELECT * FROM "DailyJournal" WHERE "date" >= ? AND "date" <= ? ORDER BY "date" DESC`
        : `SELECT * FROM "DailyJournal" ORDER BY "date" DESC`,
      ...(from || to ? [from ?? '0000-01-01', to ?? '9999-12-31'] : []),
    )
    return rows.map((row) => this.parseJournalRow(row))
  }

  async getJournal(date: string): Promise<DailyJournal | undefined> {
    const rows = await this.db.$queryRawUnsafe<Array<{
      id: string
      date: string
      items: string
      rawMarkdown: string
      createdAt: string
      updatedAt: string
    }>>(`SELECT * FROM "DailyJournal" WHERE "date" = ? LIMIT 1`, date)
    const row = rows[0]
    return row ? this.parseJournalRow(row) : undefined
  }

  async ensureJournal(date: string): Promise<DailyJournal> {
    const existing = await this.getJournal(date)
    if (existing) return existing
    const id = randomUUID()
    const now = new Date().toISOString()
    await this.db.$executeRawUnsafe(
      `INSERT INTO "DailyJournal" ("id", "date", "items", "rawMarkdown", "createdAt", "updatedAt")
       VALUES (?, ?, ?, ?, ?, ?)`,
      id,
      date,
      JSON.stringify([]),
      '',
      now,
      now,
    )
    const created = await this.getJournal(date)
    if (!created) throw new Error(`Failed to create journal for ${date}`)
    return created
  }

  async addJournalItem(input: {
    date: string
    title: string
    description: string
    source: 'USER' | 'GIT'
    rawSection?: string
  }): Promise<DailyJournal> {
    const journal = await this.ensureJournal(input.date)
    const items = mergeJournalItem(journal.items, {
      title: input.title,
      description: input.description,
      source: input.source,
    })
    const rawMarkdown = input.rawSection
      ? appendRawMarkdown(journal.rawMarkdown, input.rawSection)
      : appendRawMarkdown(
        journal.rawMarkdown,
        `## ${input.title.trim()}\n\n- ${input.description.trim()}`,
      )
    const now = new Date().toISOString()
    await this.db.$executeRawUnsafe(
      `UPDATE "DailyJournal" SET "items" = ?, "rawMarkdown" = ?, "updatedAt" = ? WHERE "date" = ?`,
      JSON.stringify(items),
      rawMarkdown,
      now,
      input.date,
    )
    return (await this.getJournal(input.date))!
  }

  async upsertProject(input: { name: string; path: string; gitUrl?: string }) {
    const existing = await this.db.project.findUnique({ where: { path: input.path } })
    if (existing) {
      return this.db.project.update({
        where: { id: existing.id },
        data: { name: input.name, ...(input.gitUrl ? { gitUrl: input.gitUrl } : {}) },
      })
    }
    return this.db.project.create({ data: input })
  }

  async saveGitSnapshot(input: {
    projectId: string
    commitHash: string
    changes: unknown
    summary?: string
  }) {
    return this.db.gitSnapshot.create({
      data: {
        projectId: input.projectId,
        commitHash: input.commitHash,
        changes: input.changes as Prisma.InputJsonValue,
        ...(input.summary ? { summary: input.summary } : {}),
      },
    })
  }

  async listModelProviders() {
    return this.db.modelProvider.findMany({
      select: {
        id: true, name: true, providerType: true, baseUrl: true,
        credentialKey: true, model: true, enabled: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }
  async createModelProvider(input: {
    name: string
    providerType: string
    baseUrl?: string
    credentialKey: string
    model: string
    enabled: boolean
  }) {
    if (input.enabled) await this.db.modelProvider.updateMany({ data: { enabled: false } })
    return this.db.modelProvider.create({
      data: {
        name: input.name,
        providerType: input.providerType,
        credentialKey: input.credentialKey,
        model: input.model,
        enabled: input.enabled,
        ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
      },
    })
  }
  async enabledModelProvider() {
    return this.db.modelProvider.findFirst({ where: { enabled: true }, orderBy: { updatedAt: 'desc' } })
  }

  async settings(): Promise<Record<string, string>> {
    const rows = await this.db.userSetting.findMany()
    return Object.fromEntries(rows.map((row) => [row.key, row.value]))
  }
  async setSetting(key: string, value: string) {
    return this.db.userSetting.upsert({ where: { key }, create: { key, value }, update: { value } })
  }

  async listNotifyMessages() {
    const rows = await this.db.$queryRawUnsafe<Array<{
      id: string
      title: string
      tag: string
      label: string
      value: string
      previousValue: string | null
      workflowId: string | null
      unread: number | boolean
      createdAt: string
      updatedAt: string
    }>>(`SELECT * FROM "NotifyMessage" ORDER BY datetime("updatedAt") DESC`)
    return rows.map((row) => ({
      ...row,
      unread: Boolean(row.unread),
      previousValue: row.previousValue ?? null,
    }))
  }

  async countUnreadMessages() {
    const rows = await this.db.$queryRawUnsafe<Array<{ count: number | bigint }>>(
      `SELECT COUNT(*) as count FROM "NotifyMessage" WHERE "unread" = 1`,
    )
    return Number(rows[0]?.count ?? 0)
  }

  async markMessageRead(id: string) {
    await this.db.$executeRawUnsafe(
      `UPDATE "NotifyMessage" SET "unread" = 0, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
      id,
    )
  }

  async markAllMessagesRead() {
    await this.db.$executeRawUnsafe(
      `UPDATE "NotifyMessage" SET "unread" = 0, "updatedAt" = CURRENT_TIMESTAMP WHERE "unread" = 1`,
    )
  }

  async upsertExtractMessage(input: {
    workflowId: string
    title: string
    label: string
    value: string
  }) {
    const existing = await this.db.$queryRawUnsafe<Array<{
      id: string
      value: string
    }>>(
      `SELECT "id", "value" FROM "NotifyMessage" WHERE "workflowId" = ? AND "label" = ? LIMIT 1`,
      input.workflowId,
      input.label,
    )
    const current = existing[0]
    if (!current) {
      const { randomUUID } = await import('node:crypto')
      const id = randomUUID()
      await this.db.$executeRawUnsafe(
        `INSERT INTO "NotifyMessage"
          ("id", "title", "tag", "label", "value", "previousValue", "workflowId", "unread", "createdAt", "updatedAt")
         VALUES (?, ?, 'workflow', ?, ?, NULL, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        id,
        input.title,
        input.label,
        input.value,
        input.workflowId,
      )
      return { id, created: true, changed: true }
    }
    const changed = current.value !== input.value
    if (!changed) {
      await this.db.$executeRawUnsafe(
        `UPDATE "NotifyMessage"
         SET "title" = ?, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = ?`,
        input.title,
        current.id,
      )
      return { id: current.id, created: false, changed: false }
    }
    await this.db.$executeRawUnsafe(
      `UPDATE "NotifyMessage"
       SET "title" = ?, "value" = ?, "previousValue" = ?, "unread" = 1, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = ?`,
      input.title,
      input.value,
      current.value,
      current.id,
    )
    return { id: current.id, created: false, changed: true }
  }

  async listNotifySchedules() {
    return this.db.$queryRawUnsafe<Array<{
      id: string
      workflowId: string
      intervalMinutes: number
      enabled: number | boolean
      lastRunAt: string | null
      nextRunAt: string | null
      createdAt: string
      updatedAt: string
    }>>(`SELECT * FROM "NotifySchedule" ORDER BY datetime("createdAt") DESC`)
  }

  async createNotifySchedule(input: { workflowId: string; intervalMinutes: number }) {
    const { randomUUID } = await import('node:crypto')
    const id = randomUUID()
    const minutes = Math.max(1, Math.floor(input.intervalMinutes))
    const next = new Date(Date.now() + minutes * 60_000).toISOString()
    await this.db.$executeRawUnsafe(
      `INSERT INTO "NotifySchedule"
        ("id", "workflowId", "intervalMinutes", "enabled", "lastRunAt", "nextRunAt", "createdAt", "updatedAt")
       VALUES (?, ?, ?, 1, NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id,
      input.workflowId,
      minutes,
      next,
    )
    return { id, workflowId: input.workflowId, intervalMinutes: minutes, enabled: true, nextRunAt: next }
  }

  async deleteNotifySchedule(id: string) {
    await this.db.$executeRawUnsafe(`DELETE FROM "NotifySchedule" WHERE "id" = ?`, id)
  }

  async setNotifyScheduleEnabled(id: string, enabled: boolean) {
    await this.db.$executeRawUnsafe(
      `UPDATE "NotifySchedule" SET "enabled" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
      enabled ? 1 : 0,
      id,
    )
  }

  async dueNotifySchedules(now = new Date()) {
    return this.db.$queryRawUnsafe<Array<{
      id: string
      workflowId: string
      intervalMinutes: number
    }>>(
      `SELECT "id", "workflowId", "intervalMinutes" FROM "NotifySchedule"
       WHERE "enabled" = 1 AND ("nextRunAt" IS NULL OR datetime("nextRunAt") <= datetime(?))`,
      now.toISOString(),
    )
  }

  async markNotifyScheduleRun(id: string, intervalMinutes: number) {
    const next = new Date(Date.now() + Math.max(1, intervalMinutes) * 60_000).toISOString()
    await this.db.$executeRawUnsafe(
      `UPDATE "NotifySchedule"
       SET "lastRunAt" = CURRENT_TIMESTAMP, "nextRunAt" = ?, "updatedAt" = CURRENT_TIMESTAMP
       WHERE "id" = ?`,
      next,
      id,
    )
  }
}
