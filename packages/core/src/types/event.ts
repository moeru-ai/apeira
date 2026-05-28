import type { Event as XSAIEvent } from '@xsai-ext/responses'

import type { ToolInterruption } from './plugin'

export type AgentEvent = WithId<ApeiraEvent | XSAIEvent>

export type ApeiraEvent
  = | ToolInterruptionEvent
    | TurnAbortedEvent
    | TurnDoneEvent
    | TurnFailedEvent
    | TurnInputDrainedEvent
    | TurnInputQueuedEvent
    | TurnQueuedEvent
    | TurnStartEvent

export interface ToolInterruptionEvent {
  interruption: ToolInterruption
  type: 'tool-interruption'
}

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

export type WithId<T> = T & {
  sessionId: string
  turnId: string
}
