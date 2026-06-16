import type { AgentInput } from '@apeira/core'

import type { FileStoreOptions } from './utils/types'

import { createFileStore } from './utils/file-store'

export interface JSONLStoreOptions<T> extends FileStoreOptions<T> {}

const encode = <T>(items: readonly T[]): string =>
  items.map(item => JSON.stringify(item)).join('\n') + (items.length > 0 ? '\n' : '')

const decode = <T>(raw: string): T[] => {
  const lines = raw.split('\n')
  const result: T[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0)
      continue

    try {
      result.push(JSON.parse(trimmed) as T)
    }
    catch {
      // ignore corrupt lines
    }
  }

  return result
}

export const jsonl = <T = AgentInput>(options: JSONLStoreOptions<T>) =>
  createFileStore<T>(options, { decode, encode })
