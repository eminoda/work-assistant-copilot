/**
 * Build a slim desktop Runtime payload for Tauri resources.
 *
 * Do NOT ship a pnpm deploy / node_modules tree into NSIS — path length and file
 * count will keep breaking Windows installers. Instead:
 *   resources/runtime/
 *     node/node[.exe]     portable Node (pinned)
 *     app/server.mjs      esbuild bundle of agent-core
 *     app/generated/prisma pruned Prisma client
 *     app/node_modules/   ONLY native / dynamic deps (better-sqlite3, playwright*)
 */
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  rmSync,
  chmodSync,
  copyFileSync,
  cpSync,
  readdirSync,
  statSync,
  lstatSync,
  writeFileSync,
  readFileSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'
import * as esbuild from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const runtimeRoot = join(root, 'apps/desktop-agent/src-tauri/resources/runtime')
const appOut = join(runtimeRoot, 'app')
const nodeOut = join(runtimeRoot, 'node')
const prismaGenerated = join(root, 'packages/agent-core/generated/prisma')

const NODE_VERSION = process.env.WORKCOPILOT_BUNDLE_NODE_VERSION || 'v22.14.0'
const WINDOWS_NSIS_PATH_BUDGET = 240
const WINDOWS_RESOURCE_PREFIX =
  'D:/a/work-assistant-copilot/work-assistant-copilot/apps/desktop-agent/src-tauri/resources/runtime/app'

function platformBundle() {
  const { platform, arch } = process
  if (platform === 'win32' && arch === 'x64') {
    return {
      key: 'win-x64',
      url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip`,
      nodeRel: `node-${NODE_VERSION}-win-x64/node.exe`,
      nodeName: 'node.exe',
      kind: 'zip',
    }
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return {
      key: 'darwin-arm64',
      url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-arm64.tar.gz`,
      nodeRel: `node-${NODE_VERSION}-darwin-arm64/bin/node`,
      nodeName: 'node',
      kind: 'tar.gz',
    }
  }
  if (platform === 'darwin' && arch === 'x64') {
    return {
      key: 'darwin-x64',
      url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-darwin-x64.tar.gz`,
      nodeRel: `node-${NODE_VERSION}-darwin-x64/bin/node`,
      nodeName: 'node',
      kind: 'tar.gz',
    }
  }
  if (platform === 'linux' && arch === 'x64') {
    return {
      key: 'linux-x64',
      url: `https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz`,
      nodeRel: `node-${NODE_VERSION}-linux-x64/bin/node`,
      nodeName: 'node',
      kind: 'tar.gz',
    }
  }
  throw new Error(`Unsupported platform for bundled runtime: ${platform}/${arch}`)
}

function run(cmd, opts = {}) {
  console.log(`[prepare-runtime] $ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit', shell: true, ...opts })
}

async function download(url, dest) {
  console.log(`[prepare-runtime] download ${url}`)
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status} ${url}`)
  }
  mkdirSync(dirname(dest), { recursive: true })
  await pipeline(Readable.fromWeb(response.body), createWriteStream(dest))
}

function extractZip(zipPath, destDir) {
  mkdirSync(destDir, { recursive: true })
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -Force -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}'`,
      ],
      { stdio: 'inherit' },
    )
    return
  }
  execFileSync('unzip', ['-o', zipPath, '-d', destDir], { stdio: 'inherit' })
}

function extractTarGz(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true })
  execFileSync('tar', ['-xzf', archivePath, '-C', destDir], { stdio: 'inherit' })
}

async function ensureNode(bundle) {
  const marker = join(nodeOut, `.node-${NODE_VERSION}-${bundle.key}`)
  const nodeBin = join(nodeOut, bundle.nodeName)
  if (existsSync(nodeBin) && existsSync(marker)) {
    console.log(`[prepare-runtime] reuse bundled node at ${nodeBin}`)
    return nodeBin
  }

  rmSync(nodeOut, { recursive: true, force: true })
  mkdirSync(nodeOut, { recursive: true })
  const cacheDir = join(root, '.cache/node-dist')
  mkdirSync(cacheDir, { recursive: true })
  const archiveName = bundle.url.split('/').pop()
  const archivePath = join(cacheDir, archiveName)
  if (!existsSync(archivePath)) {
    await download(bundle.url, archivePath)
  }

  const extractDir = join(cacheDir, `extract-${bundle.key}`)
  rmSync(extractDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })
  if (bundle.kind === 'zip') extractZip(archivePath, extractDir)
  else extractTarGz(archivePath, extractDir)

  const extractedNode = join(extractDir, bundle.nodeRel)
  if (!existsSync(extractedNode)) {
    throw new Error(`Node binary missing after extract: ${extractedNode}`)
  }
  copyFileSync(extractedNode, nodeBin)
  if (process.platform !== 'win32') chmodSync(nodeBin, 0o755)
  const hash = createHash('sha256').update(NODE_VERSION + bundle.key).digest('hex').slice(0, 12)
  await pipeline(Readable.from([hash]), createWriteStream(marker))
  console.log(`[prepare-runtime] bundled node -> ${nodeBin}`)
  return nodeBin
}

function resolvePackageDir(specifier, fromPackageJson) {
  const req = createRequire(fromPackageJson)
  let entry
  try {
    entry = req.resolve(`${specifier}/package.json`)
    return dirname(entry)
  } catch {
    entry = req.resolve(specifier)
  }
  let dir = dirname(entry)
  for (;;) {
    const pkgJson = join(dir, 'package.json')
    if (existsSync(pkgJson)) {
      try {
        if (JSON.parse(readFileSync(pkgJson, 'utf8')).name === specifier) return dir
      } catch {
        /* keep walking */
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error(`Cannot resolve package directory for ${specifier}`)
}

function copyPackageFlat(specifier, fromPackageJson) {
  const src = resolvePackageDir(specifier, fromPackageJson)
  const dest = join(appOut, 'node_modules', ...specifier.split('/'))
  mkdirSync(dirname(dest), { recursive: true })
  rmSync(dest, { recursive: true, force: true })
  console.log(`[prepare-runtime] copy ${specifier}: ${src} -> ${dest}`)
  cpSync(src, dest, { recursive: true, dereference: true })
  return dest
}

function packageHasDotNode(pkgDir) {
  const stack = [pkgDir]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue
      const full = join(dir, name)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(full)
      else if (name.endsWith('.node')) return true
    }
  }
  return false
}

function pruneDir(path) {
  if (existsSync(path)) rmSync(path, { recursive: true, force: true })
}

function pruneBetterSqlite3(pkgDir) {
  for (const rel of [
    'build/deps',
    'deps',
    'src',
    'build/Release/obj',
    'build/Release/objtmp',
  ]) {
    pruneDir(join(pkgDir, rel))
  }
  const testExt = join(pkgDir, 'build/Release/test_extension.node')
  if (existsSync(testExt)) rmSync(testExt, { force: true })
}

function pruneUnusedPrismaFiles(dir) {
  const unused = /\.(cockroachdb|mongodb|mysql|postgresql|sqlserver)\./i
  let removed = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const name of readdirSync(cur)) {
      const full = join(cur, name)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      if (unused.test(name)) {
        rmSync(full, { force: true })
        removed += 1
      }
    }
  }
  console.log(`[prepare-runtime] pruned ${removed} unused prisma engine files`)
}

function assertNoOverlongPaths(appDir, limit = WINDOWS_NSIS_PATH_BUDGET) {
  let worst = { len: 0, path: '' }
  const stack = [appDir]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) {
        stack.push(full)
        continue
      }
      const estimated = WINDOWS_RESOURCE_PREFIX.length - appOut.length + full.length
      if (estimated > worst.len) worst = { len: estimated, path: full }
      if (estimated > limit) {
        throw new Error(
          `Bundled runtime path too long for Windows NSIS (${estimated} chars): ${full}`,
        )
      }
    }
  }
  console.log(`[prepare-runtime] longest estimated Windows path: ${worst.len} chars (${worst.path})`)
}

function countFiles(dir) {
  let n = 0
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()
    for (const name of readdirSync(cur)) {
      const full = join(cur, name)
      const st = statSync(full)
      if (st.isDirectory()) stack.push(full)
      else n += 1
    }
  }
  return n
}

async function bundleServer() {
  const entry = join(root, 'packages/agent-core/dist/server.js')
  if (!existsSync(entry)) {
    throw new Error(`Missing ${entry}; build agent-core first`)
  }
  const outfile = join(appOut, 'server.cjs')
  console.log(`[prepare-runtime] esbuild ${entry} -> ${outfile}`)
  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    legalComments: 'none',
    // Native / browser-automation packages stay on disk next to the bundle.
    external: ['better-sqlite3', 'playwright', 'playwright-core', 'electron'],
    logLevel: 'info',
  })
  return outfile
}

async function prepareAppTree() {
  console.log('[prepare-runtime] build agent-core workspace packages')
  run('pnpm db:generate')
  run('pnpm --filter @workcopilot/agent-core... build')

  if (!existsSync(join(prismaGenerated, 'index.js'))) {
    throw new Error(`Generated Prisma client missing at ${prismaGenerated}`)
  }

  rmSync(appOut, { recursive: true, force: true })
  mkdirSync(join(appOut, 'node_modules'), { recursive: true })

  writeFileSync(
    join(appOut, 'package.json'),
    `${JSON.stringify({ name: 'workcopilot-runtime', private: true, type: 'module' }, null, 2)}\n`,
  )

  await bundleServer()

  // Prisma generated client (CJS + sqlite wasm) — loaded via process.cwd()/generated/prisma
  const prismaDest = join(appOut, 'generated/prisma')
  console.log(`[prepare-runtime] copy prisma generated -> ${prismaDest}`)
  cpSync(prismaGenerated, prismaDest, { recursive: true })
  pruneUnusedPrismaFiles(prismaDest)

  const fromAgent = join(root, 'packages/agent-core/package.json')
  const fromPlaywright = join(root, 'packages/playwright-runtime/package.json')

  const sqliteDest = copyPackageFlat('better-sqlite3', fromAgent)
  pruneBetterSqlite3(sqliteDest)
  if (!packageHasDotNode(sqliteDest)) {
    throw new Error(
      `better-sqlite3 native binding (.node) missing at ${sqliteDest}. ` +
        `Ensure pnpm install built/downloaded prebuilds for Node ${NODE_VERSION}.`,
    )
  }

  // Required by Prisma's generated runtime/client.js when client lives outside node_modules/@prisma/client.
  copyPackageFlat('@prisma/client-runtime-utils', fromAgent)

  copyPackageFlat('playwright', fromPlaywright)
  {
    const playwrightSrcPkg = join(
      resolvePackageDir('playwright', fromPlaywright),
      'package.json',
    )
    const playwrightCoreSrc = dirname(
      createRequire(playwrightSrcPkg).resolve('playwright-core/package.json'),
    )
    const playwrightCoreDest = join(appOut, 'node_modules/playwright-core')
    console.log(`[prepare-runtime] copy playwright-core: ${playwrightCoreSrc} -> ${playwrightCoreDest}`)
    rmSync(playwrightCoreDest, { recursive: true, force: true })
    cpSync(playwrightCoreSrc, playwrightCoreDest, { recursive: true, dereference: true })
  }

  assertNoOverlongPaths(appOut)

  const files = countFiles(appOut)
  console.log(`[prepare-runtime] app payload files: ${files}`)
  if (files > 2500) {
    throw new Error(`Runtime app payload still too large (${files} files); expected a slim bundle`)
  }

  if (!existsSync(join(appOut, 'server.cjs'))) {
    throw new Error('server.cjs missing after bundle')
  }
}

async function main() {
  mkdirSync(runtimeRoot, { recursive: true })
  const bundle = platformBundle()
  await ensureNode(bundle)
  await prepareAppTree()
  console.log('[prepare-runtime] done')
  console.log(`[prepare-runtime] node: ${join(nodeOut, bundle.nodeName)}`)
  console.log(`[prepare-runtime] app:  ${join(appOut, 'server.cjs')}`)
}

main().catch((error) => {
  console.error('[prepare-runtime] failed', error)
  process.exit(1)
})
