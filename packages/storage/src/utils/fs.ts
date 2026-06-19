import { readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const readFileSafe = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, 'utf-8')
  }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return

    throw error
  }
}

export const writeFileAtomic = async (path: string, content: string) => {
  const tmpPath = join(dirname(path), `.tmp-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`)
  try {
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, path)
  }
  catch (error) {
    try {
      await unlink(tmpPath)
    }
    catch {}
    throw error
  }
}
