import type { ApeiraPlugin } from '@apeira/core'
import type { CreateStorageOptions } from 'unstorage'

import type { ThreadSnapshot } from '../../core/src/utils/thread-store'

import { createStorage } from 'unstorage'

import { name, version } from '../package.json'

export const unstorage = (options: CreateStorageOptions): ApeiraPlugin => {
  const storage = createStorage(options)

  return {
    loadThread: async ({ threadId }) => {
      const data = await storage.getItem<string>(`thread:${threadId}`)
      if (data != null) {
        try {
          return JSON.parse(data) as ThreadSnapshot
        }
        catch {}
      }
      return undefined
    },
    name,
    saveThread: async ({ snapshot, threadId }) =>
      storage.setItem(`thread:${threadId}`, JSON.stringify(snapshot)),
    version,
  }
}
