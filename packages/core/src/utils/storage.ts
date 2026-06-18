import type { AgentEntry } from '../types/entry'
import type { AgentInput } from '../types/input'
import type { AgentStorage } from '../types/storage'

import { entry } from '../utils/entry'

export const mem = (initial?: readonly (AgentEntry | AgentInput)[]): AgentStorage<AgentEntry> => {
  const initialItems = initial?.map(item => 'data' in item ? item : entry('input', item)) ?? []
  let items = [...initialItems]

  return {
    append: (...appendItems) => {
      items.push(...appendItems)
    },
    clear: () => {
      items.length = 0
    },
    read: () => items,
    reset: () => {
      items = [...initialItems]
    },
  }
}

export const none = (): AgentStorage<AgentEntry> => ({
  append: () => {},
  clear: () => {},
  read: () => [],
  reset: () => {},
})
