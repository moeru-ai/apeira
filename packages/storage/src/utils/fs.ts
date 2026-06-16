import { readFile, writeFile } from 'node:fs/promises'

export const readFileSafe = async (path: string): Promise<null | string> => {
  try {
    return await readFile(path, 'utf-8')
  }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT')
      return null

    throw error
  }
}

export const writeFileSafe = async (path: string, content: string) =>
  writeFile(path, content, 'utf-8')
