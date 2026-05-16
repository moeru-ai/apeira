import type { ItemParam } from '../types/responses'

export interface ThreadSnapshot {
  items: ItemParam[]
  version: number
}

export interface ThreadStore {
  append: (items: ItemParam[]) => void
  commit: (version: number, items: ItemParam[]) => boolean
  hydrate: (snapshot: ThreadSnapshot) => void
  reset: () => void
  snapshot: () => ThreadSnapshot
}

export const createThreadStore = (initialItems: ItemParam[] = []): ThreadStore => {
  const initial = [...initialItems]
  let items = [...initial]
  let version = 0

  return {
    append: (nextItems) => {
      if (nextItems.length === 0)
        return

      items = [...items, ...nextItems]
      version += 1
    },
    commit: (expectedVersion, nextItems) => {
      if (expectedVersion !== version)
        return false

      items = [...nextItems]
      version += 1
      return true
    },
    hydrate: (snapshot) => {
      items = [...snapshot.items]
      version = snapshot.version
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
