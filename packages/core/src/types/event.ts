import type { Event as XSAIEvent } from '@xsai-ext/responses'

// export interface AgentEndEvent {
//   type: 'agent.end'
// }

export type AgentEvent = WithTurnId<ApeiraEvent | XSAIEvent>

// export interface AgentStartEvent {
//   type: 'agent.start'
// }

export type ApeiraEvent
  = | TurnAbortedEvent
    | TurnDoneEvent
    | TurnFailedEvent
    | TurnInputDrainedEvent
    | TurnInputQueuedEvent
    | TurnQueuedEvent
    | TurnStartEvent

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

export interface TurnInputDrainedEvent {
  count: number
  type: 'turn.input_drained'
}

export interface TurnInputQueuedEvent {
  type: 'turn.input_queued'
}

export interface TurnQueuedEvent {
  type: 'turn.queued'
}

export interface TurnStartEvent {
  type: 'turn.start'
}

export type WithTurnId<T> = T & {
  turnId: string
}
