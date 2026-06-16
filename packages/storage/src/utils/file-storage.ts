import type { AgentStorage } from '@apeira/core'

import type { FileStorageOptions } from './types'

import { readFileSafe, writeFileSafe } from './fs'
import { createKeyedQueue } from './keyed-queue'

const enqueue = createKeyedQueue<string>()

export interface FileStorageCodec<T> {
  decode: (raw: string) => T[]
  encode: (items: readonly T[]) => string
}

export const createFileStorage = <T>(options: FileStorageOptions<T>, codec: FileStorageCodec<T>): AgentStorage<T> => {
  const path = options.path

  const readItems = async (): Promise<T[]> => {
    const raw = await readFileSafe(path)

    if (raw == null) {
      const initial = options.initial ?? []
      if (initial.length > 0)
        await writeItems(initial)
      return [...initial]
    }

    return codec.decode(raw)
  }

  const writeItems = async (items: readonly T[]) =>
    writeFileSafe(path, codec.encode(items))

  return {
    append: async (...items) => enqueue(path, async () => {
      if (items.length === 0)
        return

      const existing = await readItems()
      await writeItems([...existing, ...items])
    }),

    clear: async () => enqueue(path, async () => writeItems([])),

    read: async () => enqueue(path, async () => Object.freeze(await readItems())),

    reset: async () => enqueue(path, async () => writeItems(options.initial ?? [])),
  }
}
