import type { Event as XSAIEvent } from '@xsai-ext/responses'

// export interface AgentEndEvent {
//   type: 'agent.end'
// }

export type AgentEvent = WithTurnId<ApeiraEvent | XSAIEvent>

// export interface AgentStartEvent {
//   type: 'agent.start'
// }

export type ApeiraEvent = TurnAbortedEvent | TurnDoneEvent | TurnFailedEvent | TurnStartEvent

export interface TurnAbortedEvent {
  reason?: unknown
  type: 'turn.aborted'
}

export interface TurnDoneEvent {
  type: 'turn.done'
}

export interface TurnFailedEvent {
  error: unknown
  type: 'turn.failed'
}

export interface TurnStartEvent {
  type: 'turn.start'
}

export type WithTurnId<T> = T & {
  turnId: string
}
