import type { AgentInput } from '../types/input'
import type { AgentStorage } from '../types/storage'

export const mem = <T = AgentInput>(initial?: readonly T[]): AgentStorage<T> => {
  const initialItems = initial ?? []
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

export const none = <T = AgentInput>(): AgentStorage<T> => ({
  append: () => {},
  clear: () => {},
  read: () => [],
  reset: () => {},
})
