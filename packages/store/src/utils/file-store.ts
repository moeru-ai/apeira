import type { AgentStore } from '@apeira/core'

import type { FileStoreOptions } from './types'

import { readFileSafe, writeFileSafe } from './fs'

export interface FileStoreCodec<T> {
  decode: (raw: string) => T[]
  encode: (items: readonly T[]) => string
}

export const createFileStore = <T>(options: FileStoreOptions<T>, codec: FileStoreCodec<T>): AgentStore<T> => {
  const path = options.path

  const readItems = async (): Promise<T[]> => {
    const raw = await readFileSafe(path)
    return raw == null ? [] : codec.decode(raw)
  }

  const writeItems = async (items: readonly T[]) =>
    writeFileSafe(path, codec.encode(items))

  const ensureInitialized = async () => {
    const items = await readItems()
    if (items.length === 0 && (options.initial?.length ?? 0) > 0)
      await writeItems(options.initial ?? [])
  }

  return {
    append: async (...items) => {
      if (items.length === 0)
        return

      await ensureInitialized()
      const existing = await readItems()
      await writeItems([...existing, ...items])
    },

    clear: async () => writeItems([]),

    read: async () => {
      await ensureInitialized()
      return Object.freeze(await readItems())
    },

    reset: async () => writeItems(options.initial ?? []),
  }
}
