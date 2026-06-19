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

interface CacheState {
  initialized: boolean
  items: unknown[]
}

const caches = new Map<string, CacheState>()
const enqueue = createKeyedQueue<string>()

const getCache = <T>(path: string): CacheState & { items: T[] } => {
  let state = caches.get(path)
  if (state == null) {
    state = { initialized: false, items: [] }
    caches.set(path, state)
  }
  return state as CacheState & { items: T[] }
}

export const createFileStorage = <T>(options: FileStorageOptions<T>, codec: FileStorageCodec<T>): AgentStorage<T> => {
  const path = options.path
  const initial = options.initial ?? []
  const cache = getCache<T>(path)

  const loadItems = async (): Promise<{ fileExists: boolean, items: T[] }> => {
    if (cache.initialized)
      return { fileExists: true, items: cache.items }

    const raw = await readFileSafe(path)

    if (raw == null) {
      cache.items = [...initial]
      cache.initialized = true
      return { fileExists: false, items: cache.items }
    }

    cache.items = raw.length === 0 ? [] : codec.decode(raw)
    cache.initialized = true
    return { fileExists: true, items: cache.items }
  }

  const writeItems = async (next: readonly T[]) => {
    cache.items = [...next]
    cache.initialized = true
    await writeFileAtomic(path, codec.encode(cache.items))
  }

  return {
    append: async (...appendItems) => enqueue(path, async () => {
      if (appendItems.length === 0)
        return

      const { fileExists, items: existing } = await loadItems()
      const next = [...existing, ...appendItems]

      if (codec.appendEncode) {
        const content = codec.appendEncode(appendItems)
        if (content.length > 0) {
          if (fileExists) {
            await appendFile(path, content)
          }
          else {
            await writeFileAtomic(path, codec.appendEncode(next))
          }
        }
        cache.items = next
        cache.initialized = true
      }
      else {
        await writeItems(next)
      }
    }),

    clear: async () => enqueue(path, async () => {
      await writeFileAtomic(path, '')
      cache.items = []
      cache.initialized = true
    }),

    read: async () => enqueue(path, async () => Object.freeze([...(await loadItems()).items])),

    reset: async () => enqueue(path, async () => writeItems(initial)),
  }
}
