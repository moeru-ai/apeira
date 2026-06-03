export interface AgentCustomState {
}

export type AgentState = AgentCustomState & {
  contextLength?: string
}
