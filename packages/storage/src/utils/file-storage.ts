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

export const createFileStorage = <T>(options: FileStorageOptions, codec: FileStorageCodec<T>): AgentStorage<T> => {
  const path = options.path

  let items: T[] | undefined
  let initialized = false

  const loadItemsFromDisk = async (): Promise<{ hasContent: boolean, items: T[] }> => {
    const raw = await readFileSafe(path)

    if (raw == null) {
      items = []
      initialized = true
      return { hasContent: false, items }
    }

    if (raw.length === 0) {
      items = []
      initialized = true
      return { hasContent: false, items }
    }

    items = codec.decode(raw)
    initialized = true
    return { hasContent: true, items }
  }

  const loadItems = async (): Promise<T[]> => {
    if (initialized)
      return items!

    const { items: loaded } = await loadItemsFromDisk()
    return loaded
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

    read: async () => enqueue(path, async () => loadItems()),
  }
}
