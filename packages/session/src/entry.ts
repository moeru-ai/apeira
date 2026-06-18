import type { AgentCustomEntry, AgentEntry } from '@apeira/core'

export const createEntry = <T extends keyof AgentCustomEntry>(
  type: T,
  data: AgentCustomEntry[T],
  id: () => string,
  now: () => number,
  parentId?: string,
): AgentEntry<T> => ({
  data,
  id: id(),
  parentId,
  timestamp: now(),
  type,
})

export const isSemanticEntry = (entry: AgentEntry) =>
  entry.type === 'input' || entry.type === 'state'
