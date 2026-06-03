import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { env } from 'node:process'

const baseDir = join(env.APEIRA_CWD ?? '.', '.apeira/sessions')

const ensureDir = async (dir: string) => {
  await mkdir(dir, { recursive: true })
}

export const readJSON = async <T>(path: string): Promise<T[]> => {
  try {
    const content = await readFile(path, 'utf8')
    return JSON.parse(content) as T[]
  }
  catch {
    return []
  }
}

export const writeJSON = async <T>(path: string, items: T[]): Promise<void> => {
  await ensureDir(baseDir)
  await writeFile(path, `${JSON.stringify(items, null, 2)}\n`)
}

export const threadFilePath = (threadId: string) =>
  join(baseDir, `${threadId}.json`)
