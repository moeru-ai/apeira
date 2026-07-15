export interface AgentCustomState {
}

export type AgentState = AgentCustomState & {
  agentDescription?: string
  agentName?: string
  contextLength?: number
  userDescription?: string
  userName?: string
}
