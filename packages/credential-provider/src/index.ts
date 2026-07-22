import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'

const keySchema = z.string().regex(/^[a-zA-Z0-9._-]+$/).max(160)
const secretSchema = z.string().min(1).max(32_768)

export interface CredentialProvider {
  save(key: string, secret: string): Promise<void>
  get(key: string): Promise<string | undefined>
  remove(key: string): Promise<void>
}

export function workCopilotHome(): string {
  return process.env.WORKCOPILOT_HOME || join(homedir(), '.workcopilot')
}

export class LocalCredentialProvider implements CredentialProvider {
  constructor(private readonly root = join(workCopilotHome(), 'credentials')) {}
  #path(key: string) { return join(this.root, `${keySchema.parse(key)}.secret`) }

  async save(key: string, secret: string): Promise<void> {
    const file = this.#path(key)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, secretSchema.parse(secret), { encoding: 'utf8', mode: 0o600 })
    await chmod(file, 0o600).catch(() => undefined)
  }
  async get(key: string): Promise<string | undefined> {
    try { return await readFile(this.#path(key), 'utf8') }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
  }
  async remove(key: string): Promise<void> { await rm(this.#path(key), { force: true }) }
}

export async function getOrCreateLocalToken(provider: CredentialProvider = new LocalCredentialProvider()): Promise<string> {
  const envToken = process.env.WORKCOPILOT_TOKEN
  if (envToken) return envToken
  const existing = await provider.get('runtime.token')
  if (existing) return existing
  const token = randomBytes(32).toString('base64url')
  await provider.save('runtime.token', token)
  return token
}
