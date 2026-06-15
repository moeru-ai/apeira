/* eslint-disable @masknet/browser-no-persistent-storage */
import type { AgentInput, AgentStore } from '@apeira/core'

export interface SyncAgentStore<T = AgentInput> extends AgentStore<T> {
  read: () => Readonly<T[]>
}

export const createLocalStorageStore = <T = AgentInput>(key: string): SyncAgentStore<T> => {
  const readItems = (): T[] => {
    try {
      const raw = localStorage.getItem(key)
      if (raw == null)
        return []
      return JSON.parse(raw) as T[]
    }
    catch {
      return []
    }
  }

  const writeItems = (items: T[]) => {
    localStorage.setItem(key, JSON.stringify(items))
  }

  return {
    append: (...items) => {
      const current = readItems()
      current.push(...items)
      writeItems(current)
    },
    clear: () => {
      localStorage.removeItem(key)
    },
    read: () => readItems(),
    reset: () => {
      localStorage.removeItem(key)
    },
  }
}
