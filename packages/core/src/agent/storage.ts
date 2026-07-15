import type { MaybePromise } from '../types'
import type { AgentEntry } from './entry'

export interface AgentStorage<T = AgentEntry> {
  append: (...items: T[]) => MaybePromise<void>
  clear: () => MaybePromise<void>
  read: () => MaybePromise<Readonly<T[]>>
}

export const mem = (): AgentStorage<AgentEntry> => {
  const items: AgentEntry[] = []

  return {
    append: (...appendItems) => {
      items.push(...appendItems)
    },
    clear: () => {
      items.length = 0
    },
    read: () => items,
  }
}

export const none = (): AgentStorage<AgentEntry> => ({
  append: () => {},
  clear: () => {},
  read: () => [],
})
