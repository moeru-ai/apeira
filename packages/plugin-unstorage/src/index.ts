import type { AgentPlugin } from '@apeira/core'
import type { CreateStorageOptions } from 'unstorage'

import { createStorage } from 'unstorage'

import { name, version } from '../package.json'

export type UnstoragePluginOptions = CreateStorageOptions

export const unstorage = (options: UnstoragePluginOptions): AgentPlugin => {
  // eslint-disable-next-line @masknet/no-then
  void createStorage(options)

  return {
    name,
    version,
  }
}
