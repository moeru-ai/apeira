import type { AgentInput } from '@apeira/core'

import type { FileStoreOptions } from './utils/types'

import { createFileStore } from './utils/file-store'

export interface JSONStoreOptions<T> extends FileStoreOptions<T> {}

const encode = <T>(items: readonly T[]): string =>
  JSON.stringify(items, null, 2)

const decode = <T>(raw: string): T[] => {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value as T[] : []
  }
  catch {
    return []
  }
}

export const json = <T = AgentInput>(options: JSONStoreOptions<T>) =>
  createFileStore<T>(options, { decode, encode })
