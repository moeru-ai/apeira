import type { AgentEntry } from '@apeira/core'

import type { FileStorageOptions } from './utils/types'

import { createFileStorage } from './utils/file-storage'

export interface JSONStorageOptions<T = AgentEntry> extends FileStorageOptions<T> {}

const encode = <T>(items: readonly T[]): string =>
  `${JSON.stringify(items, null, 2)}\n`

const decode = <T>(raw: string): T[] => {
  let value: unknown
  try {
    value = JSON.parse(raw)
  }
  catch (error) {
    throw new SyntaxError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!Array.isArray(value))
    throw new Error(`Invalid storage file: expected array, got ${typeof value}`)

  return value as T[]
}

export const json = <T = AgentEntry>(options: JSONStorageOptions<T>) =>
  createFileStorage<T>(options, { decode, encode })
