export const initialSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS "UserSetting" (
    "id" TEXT NOT NULL PRIMARY KEY, "key" TEXT NOT NULL, "value" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "ModelProvider" (
    "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "providerType" TEXT NOT NULL,
    "baseUrl" TEXT, "credentialKey" TEXT NOT NULL, "model" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "Workflow" (
    "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "intent" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '', "steps" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "Recording" (
    "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "intent" TEXT NOT NULL,
    "url" TEXT, "events" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'CAPTURED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "WorkflowExecution" (
    "id" TEXT NOT NULL PRIMARY KEY, "workflowId" TEXT NOT NULL, "status" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL, "finishedAt" DATETIME, "result" JSONB, "error" TEXT,
    "events" JSONB NOT NULL,
    CONSTRAINT "WorkflowExecution_workflowId_fkey" FOREIGN KEY ("workflowId")
      REFERENCES "Workflow" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "CredentialMetadata" (
    "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "provider" TEXT NOT NULL,
    "key" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "Project" (
    "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "path" TEXT NOT NULL,
    "gitUrl" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "GitSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "commitHash" TEXT NOT NULL,
    "changes" JSONB NOT NULL, "summary" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GitSnapshot_projectId_fkey" FOREIGN KEY ("projectId")
      REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS "DailyMemory" (
    "id" TEXT NOT NULL PRIMARY KEY, "date" TEXT NOT NULL, "content" TEXT NOT NULL,
    "source" TEXT NOT NULL, "metadata" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL PRIMARY KEY, "type" TEXT NOT NULL, "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL, "content" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "UserSetting_key_key" ON "UserSetting"("key")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CredentialMetadata_key_key" ON "CredentialMetadata"("key")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Project_path_key" ON "Project"("path")`,
  `CREATE INDEX IF NOT EXISTS "DailyMemory_date_idx" ON "DailyMemory"("date")`,
  `CREATE INDEX IF NOT EXISTS "Report_type_startDate_endDate_idx" ON "Report"("type", "startDate", "endDate")`,
  `CREATE TABLE IF NOT EXISTS "NotifyMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "tag" TEXT NOT NULL DEFAULT 'workflow',
    "label" TEXT NOT NULL DEFAULT '',
    "value" TEXT NOT NULL DEFAULT '',
    "previousValue" TEXT,
    "workflowId" TEXT,
    "unread" BOOLEAN NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS "NotifySchedule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workflowId" TEXT NOT NULL,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT 1,
    "lastRunAt" DATETIME,
    "nextRunAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS "NotifyMessage_updatedAt_idx" ON "NotifyMessage"("updatedAt")`,
  `CREATE INDEX IF NOT EXISTS "NotifyMessage_unread_idx" ON "NotifyMessage"("unread")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "NotifyMessage_workflow_label_key" ON "NotifyMessage"("workflowId", "label")`,
  `CREATE INDEX IF NOT EXISTS "NotifySchedule_nextRunAt_idx" ON "NotifySchedule"("nextRunAt")`,
  `CREATE TABLE IF NOT EXISTS "DailyJournal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "rawMarkdown" TEXT NOT NULL DEFAULT '',
    "contentHash" TEXT NOT NULL DEFAULT '',
    "aiMarkdown" TEXT NOT NULL DEFAULT '',
    "aiContentHash" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "DailyJournal_date_key" ON "DailyJournal"("date")`,
  `CREATE TABLE IF NOT EXISTS "AiUsageDaily" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL DEFAULT 0,
    "inputChars" INTEGER NOT NULL DEFAULT 0,
    "outputChars" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "AiUsageDaily_date_key" ON "AiUsageDaily"("date")`,
] as const

/** Additive columns for existing DBs (SQLite ignores failures if column exists). */
export const journalColumnMigrations = [
  `ALTER TABLE "DailyJournal" ADD COLUMN "contentHash" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "DailyJournal" ADD COLUMN "aiMarkdown" TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE "DailyJournal" ADD COLUMN "aiContentHash" TEXT NOT NULL DEFAULT ''`,
] as const
