import type { AgentEvent } from './event'

export type AgentEventListener = (event: AgentEvent) => unknown
