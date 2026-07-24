import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { workflowSchema, workflowStepSchema, type ExecutionResult, type Workflow } from '@workcopilot/workflow-engine'
import { memoryRecordSchema, type MemoryRecord } from '@workcopilot/memory-engine'
import { workCopilotHome } from '@workcopilot/credential-provider'
import { initialSchemaStatements } from './migrations.js'
import { z } from 'zod'

const packedStepsSchema = z.object({
  kind: z.enum(['login', 'app']).optional(),
  homeUrl: z.string().url().optional(),
  steps: z.array(workflowStepSchema),
})

function packWorkflowSteps(workflow: Workflow): Prisma.InputJsonValue {
  return {
    kind: workflow.kind,
    ...(workflow.homeUrl ? { homeUrl: workflow.homeUrl } : {}),
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
}
