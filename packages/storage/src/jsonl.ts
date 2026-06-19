import type { AgentEntry } from '@apeira/core'

import type { FileStorageOptions } from './utils/types'

import { createFileStorage } from './utils/file-storage'

export interface JSONLStorageOptions<T = AgentEntry> extends FileStorageOptions<T> {}

const encode = <T>(items: readonly T[]): string =>
  items.map(item => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '')

const decode = <T>(raw: string): T[] => {
  const lines = raw.split('\n')
  const result: T[] = []

  for (const [i, line] of lines.entries()) {
    if (line == null)
      continue

    const trimmed = line.trim()
    if (trimmed.length === 0)
      continue

    try {
      result.push(JSON.parse(trimmed) as T)
    }
    catch (error) {
      throw new SyntaxError(`Invalid JSON at line ${i + 1}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return result
}

export const jsonl = <T = AgentEntry>(options: JSONLStorageOptions<T>) =>
  createFileStorage<T>(options, { appendEncode: encode, decode, encode })
