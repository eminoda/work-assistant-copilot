import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'apps/desktop-agent/prisma/schema.prisma',
  migrations: {
    path: 'apps/desktop-agent/prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'file:./apps/desktop-agent/prisma/dev.db',
  },
})
