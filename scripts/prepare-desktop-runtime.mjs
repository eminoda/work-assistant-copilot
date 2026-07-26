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
  renameSync,
  readFileSync,
} from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { execFileSync, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable } from 'node:stream'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const runtimeRoot = join(root, 'apps/desktop-agent/src-tauri/resources/runtime')
const appOut = join(runtimeRoot, 'app')
const nodeOut = join(runtimeRoot, 'node')

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

function assertHasNativeBinding(packageDir, label) {
  const stack = [packageDir]
  while (stack.length) {
    const dir = stack.pop()
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue
        stack.push(full)
      } else if (name.endsWith('.node')) {
        console.log(`[prepare-runtime] found native binding for ${label}: ${full}`)
        return
      }
    }
  }
  throw new Error(`Native binding (.node) missing for ${label} at ${packageDir}`)
}

function syncWorkspacePackageIntoDeploy(specifier) {
  const fromAgent = createRequire(join(root, 'packages/agent-core/package.json'))
  const fromRoot = createRequire(join(root, 'package.json'))
  let src
  try {
    src = dirname(fromAgent.resolve(`${specifier}/package.json`))
  } catch {
    src = dirname(fromRoot.resolve(`${specifier}/package.json`))
  }
  const dest = join(appOut, 'node_modules', specifier)
  mkdirSync(dirname(dest), { recursive: true })
  rmSync(dest, { recursive: true, force: true })
  console.log(`[prepare-runtime] copy ${specifier}: ${src} -> ${dest}`)
  cpSync(src, dest, { recursive: true })
  return dest
}

/**
 * pnpm deploy keeps a deep `.pnpm/<name>@<ver>_<hash>/node_modules/...` tree.
 * NSIS on Windows fails opening those long paths. Materialize a flat node_modules.
 */
function packageHasDotNode(pkgDir) {
  const stack = [pkgDir]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const name of entries) {
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

function flattenDeployNodeModules(appDir) {
  const nm = join(appDir, 'node_modules')
  const pnpmDir = join(nm, '.pnpm')
  if (!existsSync(pnpmDir)) {
    console.log('[prepare-runtime] no .pnpm store to flatten')
    return
  }

  const staging = join(appDir, '.flat-node-modules')
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })

  /** @type {Map<string, { dir: string, score: number }>} */
  const bestByName = new Map()

  function notePackage(pkgDir, prefer) {
    if (!existsSync(join(pkgDir, 'package.json'))) return
    let name
    try {
      name = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).name
    } catch {
      return
    }
    if (!name || typeof name !== 'string') return
    // Prefer: native .node present, then top-level (synced) copies over ignore-scripts store copies.
    const score = (packageHasDotNode(pkgDir) ? 100 : 0) + (prefer ? 10 : 0)
    const prev = bestByName.get(name)
    if (!prev || score > prev.score) {
      bestByName.set(name, { dir: pkgDir, score })
    }
  }

  function walkNodeModules(modulesDir, prefer) {
    if (!existsSync(modulesDir)) return
    for (const name of readdirSync(modulesDir)) {
      if (name === '.bin' || name === '.pnpm' || name.startsWith('.')) continue
      const full = join(modulesDir, name)
      let st
      try {
        st = lstatSync(full)
      } catch {
        continue
      }
      if (name.startsWith('@') && st.isDirectory() && !st.isSymbolicLink()) {
        for (const scoped of readdirSync(full)) {
          notePackage(join(full, scoped), prefer)
        }
      } else {
        notePackage(full, prefer)
      }
    }
  }

  // Top-level first (includes post-deploy synced better-sqlite3 with native binding).
  walkNodeModules(nm, true)
  for (const entry of readdirSync(pnpmDir)) {
    walkNodeModules(join(pnpmDir, entry, 'node_modules'), false)
  }

  for (const [name, { dir: pkgDir }] of bestByName) {
    const dest = join(staging, ...name.split('/'))
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(pkgDir, dest, { recursive: true, dereference: true })
  }

  console.log(`[prepare-runtime] flattened ${bestByName.size} packages into node_modules (removed .pnpm)`)
  rmSync(nm, { recursive: true, force: true })
  renameSync(staging, nm)
}

function pruneUnusedPrismaFiles(appDir) {
  const unused = /\.(cockroachdb|mongodb|mysql|postgresql|sqlserver)\./i
  let removed = 0
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
        if (name === '.git') continue
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

function pruneNativePackageJunk(appDir) {
  const junkDirs = [
    join(appDir, 'node_modules/better-sqlite3/build/deps'),
    join(appDir, 'node_modules/better-sqlite3/deps'),
    join(appDir, 'node_modules/better-sqlite3/src'),
    join(appDir, 'node_modules/better-sqlite3/build/Release/obj'),
    join(appDir, 'node_modules/better-sqlite3/build/Release/objtmp'),
  ]
  for (const dir of junkDirs) {
    if (existsSync(dir)) {
      console.log(`[prepare-runtime] remove ${dir}`)
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const testExt = join(appDir, 'node_modules/better-sqlite3/build/Release/test_extension.node')
  if (existsSync(testExt)) rmSync(testExt, { force: true })
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
  console.log(`[prepare-runtime] longest estimated Windows path: ${worst.len} chars`)
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

function prepareAppTree() {
  console.log('[prepare-runtime] build agent-core workspace packages')
  run('pnpm db:generate')
  run('pnpm --filter @workcopilot/agent-core... build')

  rmSync(appOut, { recursive: true, force: true })
  mkdirSync(dirname(appOut), { recursive: true })
  console.log(`[prepare-runtime] pnpm deploy (ignore scripts) -> ${appOut}`)
  // Avoid recompiling better-sqlite3 during deploy on CI (node-gyp/VS flakiness).
  run(`pnpm --filter @workcopilot/agent-core deploy --prod --legacy "${appOut}"`, {
    env: {
      ...process.env,
      npm_config_ignore_scripts: 'true',
    },
  })

  const sqliteDest = syncWorkspacePackageIntoDeploy('better-sqlite3')
  assertHasNativeBinding(sqliteDest, 'better-sqlite3')

  const clientDest = syncWorkspacePackageIntoDeploy('@prisma/client')
  console.log(`[prepare-runtime] prisma npm client ready at ${clientDest}`)

  const prismaGenerated = join(root, 'packages/agent-core/generated/prisma')
  if (!existsSync(join(prismaGenerated, 'index.js'))) {
    throw new Error(`Generated Prisma client missing at ${prismaGenerated}; run pnpm db:generate`)
  }
  const prismaDest = join(appOut, 'generated/prisma')
  rmSync(prismaDest, { recursive: true, force: true })
  console.log(`[prepare-runtime] copy prisma generated ${prismaGenerated} -> ${prismaDest}`)
  cpSync(prismaGenerated, prismaDest, { recursive: true })

  flattenDeployNodeModules(appOut)
  // Flatten may still pick a store copy without native bindings; force the workspace build in.
  const sqliteAfterFlat = syncWorkspacePackageIntoDeploy('better-sqlite3')
  pruneUnusedPrismaFiles(appOut)
  pruneNativePackageJunk(appOut)
  assertNoOverlongPaths(appOut)
  assertHasNativeBinding(sqliteAfterFlat, 'better-sqlite3')

  const serverJs = join(appOut, 'dist/server.js')
  if (!existsSync(serverJs)) {
    throw new Error(`Deployed runtime missing dist/server.js at ${serverJs}`)
  }
}

async function main() {
  mkdirSync(runtimeRoot, { recursive: true })
  const bundle = platformBundle()
  await ensureNode(bundle)
  prepareAppTree()
  console.log('[prepare-runtime] done')
  console.log(`[prepare-runtime] node: ${join(nodeOut, bundle.nodeName)}`)
  console.log(`[prepare-runtime] app:  ${join(appOut, 'dist/server.js')}`)
}

main().catch((error) => {
  console.error('[prepare-runtime] failed', error)
  process.exit(1)
})
