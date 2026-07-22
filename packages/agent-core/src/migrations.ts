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
] as const
