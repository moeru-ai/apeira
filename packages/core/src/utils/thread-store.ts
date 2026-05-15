import type { ItemParam } from '../types/responses'

export interface ThreadSnapshot {
  items: ItemParam[]
  version: number
}

export interface ThreadStore {
  commit: (version: number, items: ItemParam[]) => boolean
  reset: () => void
  snapshot: () => ThreadSnapshot
}

export const createThreadStore = (initialItems: ItemParam[] = []): ThreadStore => {
  const initial = [...initialItems]
  let items = [...initial]
  let version = 0

  return {
    commit: (expectedVersion, nextItems) => {
      if (expectedVersion !== version)
        return false

      items = nextItems
      return true
    },
    reset: () => {
      items = [...initial]
      version += 1
    },
    snapshot: () => ({
      items: [...items],
      version,
    }),
  }
}
