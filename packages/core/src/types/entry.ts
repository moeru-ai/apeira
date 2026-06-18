import type { AgentCustomEvent } from './event'
import type { AgentInput } from './input'
import type { AgentState } from './state'

export interface AgentEntry<T extends keyof AgentEntryData = keyof AgentEntryData> {
  data: AgentEntryData[T]
  id: string
  timestamp: number
  type: T
}

export interface AgentEntryData {
  event: AgentCustomEvent[keyof AgentCustomEvent]
  input: AgentInput
  state: AgentState
}

export type AgentEntryUnion = {
  [T in keyof AgentEntryData]: AgentEntry<T>
}[keyof AgentEntryData]
