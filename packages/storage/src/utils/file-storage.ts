import type { AgentStorage } from '@apeira/core'

import type { FileStorageOptions } from './types'

import { appendFile } from 'node:fs/promises'

import { readFileSafe, writeFileAtomic } from './fs'
import { createKeyedQueue } from './keyed-queue'

export interface FileStorageCodec<T> {
  appendEncode?: (items: readonly T[]) => string
  decode: (raw: string) => T[]
  encode: (items: readonly T[]) => string
}

const enqueue = createKeyedQueue<string>()

export const createFileStorage = <T>(options: FileStorageOptions<T>, codec: FileStorageCodec<T>): AgentStorage<T> => {
  const path = options.path
  const initial = options.initial ?? []

  let items: T[] | undefined
  let initialized = false

  const loadItemsFromDisk = async (): Promise<{ fileExists: boolean, items: T[] }> => {
    const raw = await readFileSafe(path)

    if (raw == null) {
      items = [...initial]
      initialized = true
      return { fileExists: false, items }
    }

    items = raw.length === 0 ? [] : codec.decode(raw)
    initialized = true
    return { fileExists: true, items }
  }

  const loadItems = async (): Promise<{ fileExists: boolean, items: T[] }> => {
    if (initialized)
      return { fileExists: true, items: items! }

    return loadItemsFromDisk()
  }

  const writeItems = async (next: readonly T[]) => {
    items = [...next]
    initialized = true
    await writeFileAtomic(path, codec.encode(items))
  }

  return {
    append: async (...appendItems) => enqueue(path, async () => {
      if (appendItems.length === 0)
        return

      const { hasContent, items: existing } = await loadItemsFromDisk()
      const next = [...existing, ...appendItems]

      if (codec.appendEncode) {
        if (hasContent) {
          const content = codec.appendEncode(appendItems)
          if (content.length > 0) {
            await appendFile(path, content)
          }
        }
        else {
          await writeFileAtomic(path, codec.encode(next))
        }
        items = next
        initialized = true
      }
      else {
        await writeItems(next)
      }
    }),

    clear: async () => enqueue(path, async () => {
      await writeFileAtomic(path, '')
      items = []
      initialized = true
    }),

    read: async () => enqueue(path, async () => (await loadItems()).items),

    reset: async () => enqueue(path, async () => writeItems(initial)),
  }
}
