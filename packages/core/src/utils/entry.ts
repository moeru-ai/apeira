import type { AgentCustomEntry, AgentEntry } from '../types/entry'

export const entry = <T extends keyof AgentCustomEntry>(type: T, data: AgentCustomEntry[T]): AgentEntry<T> =>
  ({ data, id: crypto.randomUUID(), timestamp: Date.now(), type })

export const toAgentInput = (entries: readonly AgentEntry[]) =>
  entries
    .filter((e): e is AgentEntry<'input'> => e.type === 'input')
    .map(e => e.data)
