import type { AgentInput } from '@apeira/core'

import type { FileStorageOptions } from './utils/types'

import { createFileStorage } from './utils/file-storage'

export interface JSONStorageOptions<T> extends FileStorageOptions<T> {}

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

export const json = <T = AgentInput>(options: JSONStorageOptions<T>) =>
  createFileStorage<T>(options, { decode, encode })
