import type { AgentPlugin } from '@apeira/core'
import type { CreateStorageOptions } from 'unstorage'

import { createStorage } from 'unstorage'

import { name, version } from '../package.json'

export type UnstoragePluginOptions = CreateStorageOptions

export const unstorage = (options: UnstoragePluginOptions): AgentPlugin => {
  const storage = createStorage(options)

  return {
    name,
    storage: {
      getItem: async key => storage.getItem<string>(key),
      removeItem: async key => storage.removeItem(key),
      setItem: async (key, value) => storage.setItem(key, value),
    },
    version,
  }
}
