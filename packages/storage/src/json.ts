import type { AgentEntry } from '@apeira/core'

import type { FileStorageOptions } from './utils/types'

import { createFileStorage } from './utils/file-storage'

export interface JSONStorageOptions<T = AgentEntry> extends FileStorageOptions<T> {}

const encode = <T>(items: readonly T[]): string =>
  `${JSON.stringify(items, null, 2)}\n`

const decode = <T>(raw: string): T[] => {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value as T[] : []
  }
  catch {
    return []
  }
}

export const json = <T = AgentEntry>(options: JSONStorageOptions<T>) =>
  createFileStorage<T>(options, { decode, encode })
