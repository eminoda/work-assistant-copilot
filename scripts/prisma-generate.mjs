import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pnpmDir = join(root, 'node_modules/.pnpm')

function run(cmd) {
  console.log(`[prisma-generate] $ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit', shell: true })
}

function listPrismaClientHosts() {
  if (!existsSync(pnpmDir)) return []
  return readdirSync(pnpmDir)
    .filter((name) => name.startsWith('@prisma+client@'))
    .map((name) => join(pnpmDir, name, 'node_modules'))
    .filter((dir) => existsSync(join(dir, '@prisma/client')))
}

function generatedMarker(prismaDir) {
  return join(prismaDir, 'client/default.d.ts')
}

function findGeneratedSource() {
  const hosts = listPrismaClientHosts()
  let best = null
  let bestMtime = -1
  for (const host of hosts) {
    const prismaDir = join(host, '.prisma')
    const marker = generatedMarker(prismaDir)
    if (!existsSync(marker)) continue
    const mtime = statSync(marker).mtimeMs
    if (mtime > bestMtime) {
      best = prismaDir
      bestMtime = mtime
    }
  }
  return best
}

function syncGeneratedClient(sourcePrismaDir) {
  const hosts = listPrismaClientHosts()
  for (const host of hosts) {
    const dest = join(host, '.prisma')
    if (dest === sourcePrismaDir) continue
    rmSync(dest, { recursive: true, force: true })
    mkdirSync(dirname(dest), { recursive: true })
    console.log(`[prisma-generate] sync ${sourcePrismaDir} -> ${dest}`)
    cpSync(sourcePrismaDir, dest, { recursive: true })
  }
  // Also keep a stable root path for tooling that resolves from workspace root.
  const rootPrisma = join(root, 'node_modules/.prisma')
  if (rootPrisma !== sourcePrismaDir) {
    rmSync(rootPrisma, { recursive: true, force: true })
    mkdirSync(dirname(rootPrisma), { recursive: true })
    cpSync(sourcePrismaDir, rootPrisma, { recursive: true })
  }
}

run('pnpm exec prisma generate --schema apps/desktop-agent/prisma/schema.prisma')

const source = findGeneratedSource()
if (!source) {
  throw new Error('prisma generate finished but no .prisma client was found under node_modules/.pnpm/@prisma+client@*')
}
console.log(`[prisma-generate] source client: ${source}`)
syncGeneratedClient(source)
console.log('[prisma-generate] synced generated client to all @prisma/client installs')
