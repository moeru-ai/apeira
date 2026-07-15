import type { AgentCustomEvent } from './event'
import type { AgentInput } from './input'
import type { AgentState } from './state'

export interface AgentCustomEntry {
  event: AgentCustomEvent[keyof AgentCustomEvent]
  input: AgentInput
  state: AgentState
}

export interface AgentEntry<T extends keyof AgentCustomEntry = keyof AgentCustomEntry> {
  data: AgentCustomEntry[T]
  id: string
  parentId?: string
  timestamp: number
  type: T
}

export type AgentEntryUnion = {
  [T in keyof AgentCustomEntry]: AgentEntry<T>
}[keyof AgentCustomEntry]

export const entry = <T extends keyof AgentCustomEntry>(type: T, data: AgentCustomEntry[T]): AgentEntry<T> =>
  ({ data, id: crypto.randomUUID(), timestamp: Date.now(), type })

export const toAgentInput = (entries: readonly AgentEntry[]) =>
  entries
    .filter((e): e is AgentEntry<'input'> => e.type === 'input')
    .map(e => e.data)
