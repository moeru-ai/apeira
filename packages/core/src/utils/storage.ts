import type { AgentEntry } from '../types/entry'
import type { AgentStorage } from '../types/storage'

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
