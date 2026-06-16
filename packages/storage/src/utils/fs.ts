import { readFile, writeFile } from 'node:fs/promises'

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

export const writeFileSafe = async (path: string, content: string) =>
  writeFile(path, content, 'utf-8')
