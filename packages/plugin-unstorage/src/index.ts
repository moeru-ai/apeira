import type { AgentPlugin, ThreadSnapshot } from '@apeira/core'
import type { CreateStorageOptions } from 'unstorage'

import { createStorage } from 'unstorage'

import { name, version } from '../package.json'

export type UnstoragePluginOptions = CreateStorageOptions

export const unstorage = (options: UnstoragePluginOptions): AgentPlugin => {
  const storage = createStorage(options)

  const getThreadKey = (threadId: string) => `thread:${threadId}`

  const parseSnapshot = (data: null | string | undefined): ThreadSnapshot | undefined => {
    if (data == null)
      return undefined

    try {
      return JSON.parse(data) as ThreadSnapshot
    }
    catch {
      return undefined
    }
  }

  return {
    loadThread: async ({ threadId }) => {
      const data = await storage.getItem<string>(getThreadKey(threadId))
      return parseSnapshot(data)
    },
    name,
    saveThread: async ({ snapshot, threadId }) =>
      storage.setItem(getThreadKey(threadId), JSON.stringify(snapshot)),
    version,
  }
}
