import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientOut = join(root, 'packages/agent-core/generated/prisma')

console.log('[prisma-generate] $ pnpm exec prisma generate --schema apps/desktop-agent/prisma/schema.prisma')
execSync('pnpm exec prisma generate --schema apps/desktop-agent/prisma/schema.prisma', {
  cwd: root,
  stdio: 'inherit',
  shell: true,
})

const marker = join(clientOut, 'index.d.ts')
if (!existsSync(marker)) {
  throw new Error(`Prisma client was not generated at ${clientOut}`)
}
console.log(`[prisma-generate] client ready at ${clientOut}`)
