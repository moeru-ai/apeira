export interface AgentCustomState {
  contextLength?: string
}

export type AgentState<T = unknown> = AgentCustomState & T
