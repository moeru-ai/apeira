import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'

const baseDir = join(env.APEIRA_CWD ?? '.', '.apeira/sessions')

export const ensureStorageDir = async () => {
  await mkdir(baseDir, { recursive: true })
}

export const threadFilePath = (threadId: string) =>
  join(baseDir, `${threadId}.json`)
