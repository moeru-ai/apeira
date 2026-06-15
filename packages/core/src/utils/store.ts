import type { AgentInput } from '../types/input'
import type { AgentStore } from '../types/store'

export const memory = <T = AgentInput>(initial?: readonly T[]): AgentStore<T> => {
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

export const noop = <T = AgentInput>(): AgentStore<T> => ({
  append: () => {},
  clear: () => {},
  read: () => [],
  reset: () => {},
})
