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
  timestamp: number
  type: T
}

export type AgentEntryUnion = {
  [T in keyof AgentCustomEntry]: AgentEntry<T>
}[keyof AgentCustomEntry]
