import type { AGUIEvent } from '@ag-ui/core'
import type { AgentEvent, AgentPlugin } from '@apeira/core'

import { EventType } from '@ag-ui/core'

import { name, version } from '../package.json'

export type { AGUIEvent } from '@ag-ui/core'

declare module '@apeira/core' {
  interface AgentCustomEvent {
    'ag-ui': AGUIEvent
  }
}

export interface AGUIPluginOptions {
  threadId: string
}

interface TurnState {
  activeReasoningMessageId?: string
  activeTextMessageId?: string
  activeToolCallId?: string
  lastAssistantMessageId?: string
  stepIndex: number
}

const createMessageId = (turnId: string, kind: string, suffix: number | string) =>
  JSON.stringify([turnId, kind, suffix])

const toErrorMessage = (value: unknown) =>
  value instanceof Error
    ? value.message
    : String(value)

export const agui = (options: AGUIPluginOptions): AgentPlugin => {
  const turnStates = new Map<string, TurnState>()

  let unsubscribe: (() => void) | undefined

  const getTurnState = (turnId: string): TurnState => {
    const existing = turnStates.get(turnId)
    if (existing != null)
      return existing

    const created: TurnState = { stepIndex: 0 }
    turnStates.set(turnId, created)
    return created
  }

  const cleanup = (turnId: string) => {
    turnStates.delete(turnId)
  }

  const threadId = options.threadId ?? ''

  const handleEvent = (emit: (event: AGUIEvent) => void, event: AgentEvent) => {
    // eslint-disable-next-line ts/switch-exhaustiveness-check
    switch (event.type) {
      case 'error': {
        emit({
          message: event.message,
          rawEvent: event,
          timestamp: Date.now(),
          type: EventType.RUN_ERROR,
        })
        return
      }

      case 'reasoning.delta': {
        const state = getTurnState(event.turnId)
        const messageId = state.activeReasoningMessageId ?? createMessageId(event.turnId, 'reasoning', 'fallback')

        if (state.activeReasoningMessageId == null) {
          state.activeReasoningMessageId = messageId

          emit({
            messageId,
            rawEvent: event,
            timestamp: Date.now(),
            type: EventType.REASONING_START,
          })
          emit({
            messageId,
            rawEvent: event,
            role: 'reasoning',
            timestamp: Date.now(),
            type: EventType.REASONING_MESSAGE_START,
          })
        }

        emit({
          delta: event.delta,
          messageId,
          rawEvent: event,
          timestamp: Date.now(),
          type: EventType.REASONING_MESSAGE_CONTENT,
        })
        return
      }

      case 'reasoning.start': {
        const state = getTurnState(event.turnId)
        const messageId = createMessageId(event.turnId, 'reasoning', Math.max(1, state.stepIndex))

        state.activeReasoningMessageId = messageId

        emit({
          messageId,
          rawEvent: event,
          timestamp: Date.now(),
          type: EventType.REASONING_START,
        })
        emit({
          messageId,
          rawEvent: event,
          role: 'reasoning',
          timestamp: Date.now(),
          type: EventType.REASONING_MESSAGE_START,
        })
        return
      }

      case 'step.done': {
        const state = getTurnState(event.turnId)

        emit({
          rawEvent: event,
          stepName: `step-${Math.max(1, state.stepIndex)}`,
          timestamp: Date.now(),
          type: EventType.STEP_FINISHED,
        })
        return
      }

      case 'step.start': {
        const state = getTurnState(event.turnId)
        state.stepIndex += 1

        emit({
          rawEvent: event,
          stepName: `step-${state.stepIndex}`,
          timestamp: Date.now(),
          type: EventType.STEP_STARTED,
        })
        return
      }

      case 'text.delta': {
        const state = getTurnState(event.turnId)
        const messageId = state.activeTextMessageId ?? createMessageId(event.turnId, 'text', 'fallback')

        if (state.activeTextMessageId == null) {
          state.activeTextMessageId = messageId
          state.lastAssistantMessageId = messageId

          emit({
            messageId,
            rawEvent: event,
            role: 'assistant',
            timestamp: Date.now(),
            type: EventType.TEXT_MESSAGE_START,
          })
        }

        emit({
          delta: event.delta,
          messageId,
          rawEvent: event,
          timestamp: Date.now(),
          type: EventType.TEXT_MESSAGE_CONTENT,
        })
        return
      }

      case 'text.done': {
        const state = getTurnState(event.turnId)
        const messageId = state.activeTextMessageId ?? state.lastAssistantMessageId ?? createMessageId(event.turnId, 'text', 'fallback')

        if (state.activeTextMessageId == null) {
          emit({
            messageId,
            rawEvent: event,
            role: 'assistant',
            timestamp: Date.now(),
            type: EventType.TEXT_MESSAGE_START,
          })
        }

        emit({
          messageId,
          rawEvent: event,
          timestamp: Date.now(),
          type: EventType.TEXT_MESSAGE_END,
        })
        state.activeTextMessageId = undefined
        state.lastAssistantMessageId = messageId
        return
      }

      case 'text.start': {
        const state = getTurnState(event.turnId)
        const messageId = createMessageId(event.turnId, 'text', Math.max(1, state.stepIndex))

        state.activeTextMessageId = messageId
        state.lastAssistantMessageId = messageId

        emit({
          messageId,
          rawEvent: event,
          role: 'assistant',
          timestamp: Date.now(),
          type: EventType.TEXT_MESSAGE_START,
        })
        return
      }

      case 'tool-call.delta': {
        const state = getTurnState(event.turnId)
        const toolCallId = state.activeToolCallId ?? createMessageId(event.turnId, 'tool-call', 'fallback')

        emit({
          delta: event.delta,
          rawEvent: event,
          timestamp: Date.now(),
          toolCallId,
          type: EventType.TOOL_CALL_ARGS,
        })
        return
      }

      case 'tool-call.done': {
        const state = getTurnState(event.turnId)
        emit({
          rawEvent: event,
          timestamp: Date.now(),
          toolCallId: event.toolCallId,
          type: EventType.TOOL_CALL_END,
        })
        state.activeToolCallId = undefined
        return
      }

      case 'tool-call.start': {
        const state = getTurnState(event.turnId)
        state.activeToolCallId = event.toolCallId

        emit({
          parentMessageId: state.lastAssistantMessageId,
          rawEvent: event,
          timestamp: Date.now(),
          toolCallId: event.toolCallId,
          toolCallName: event.toolName,
          type: EventType.TOOL_CALL_START,
        })
        return
      }

      case 'tool-result.done': {
        emit({
          content: typeof event.result === 'string'
            ? event.result
            : JSON.stringify(event.result),
          messageId: createMessageId(event.turnId, 'tool-result', event.toolCallId),
          rawEvent: event,
          role: 'tool',
          timestamp: Date.now(),
          toolCallId: event.toolCallId,
          type: EventType.TOOL_CALL_RESULT,
        })
        return
      }

      case 'turn.aborted': {
        emit({
          rawEvent: event,
          result: { reason: event.reason, status: 'aborted' },
          runId: event.turnId,
          threadId,
          timestamp: Date.now(),
          type: EventType.RUN_FINISHED,
        })
        cleanup(event.turnId)
        return
      }

      case 'turn.done': {
        emit({
          rawEvent: event,
          runId: event.turnId,
          threadId,
          timestamp: Date.now(),
          type: EventType.RUN_FINISHED,
        })
        cleanup(event.turnId)
        return
      }

      case 'turn.failed': {
        emit({
          code: 'turn_failed',
          message: toErrorMessage(event.error),
          rawEvent: event,
          timestamp: Date.now(),
          type: EventType.RUN_ERROR,
        })
        cleanup(event.turnId)
        return
      }

      case 'turn.start': {
        getTurnState(event.turnId)
        emit({
          rawEvent: event,
          runId: event.turnId,
          threadId,
          timestamp: Date.now(),
          type: EventType.RUN_STARTED,
        })
        return
      }

      case 'reasoning.done': {
        const state = getTurnState(event.turnId)
        const messageId = state.activeReasoningMessageId ?? createMessageId(event.turnId, 'reasoning', 'fallback')

        if (state.activeReasoningMessageId == null) {
          emit({
            messageId,
            rawEvent: event,
            timestamp: Date.now(),
            type: EventType.REASONING_START,
          })
          emit({
            messageId,
            rawEvent: event,
            role: 'reasoning',
            timestamp: Date.now(),
            type: EventType.REASONING_MESSAGE_START,
          })
        }

        emit({
          messageId,
          rawEvent: event,
          timestamp: Date.now(),
          type: EventType.REASONING_MESSAGE_END,
        })
        emit({
          messageId,
          rawEvent: event,
          timestamp: Date.now(),
          type: EventType.REASONING_END,
        })
        state.activeReasoningMessageId = undefined
      }
    }
  }

  return ({
    init: (agent) => {
      const emit = (event: AGUIEvent) => {
        void agent.emit('ag-ui', event)
      }
      unsubscribe = agent.subscribe('apeira', (event) => {
        handleEvent(emit, event)
      })
    },
    name,
    stop: () => {
      unsubscribe?.()
      unsubscribe = undefined
    },
    version,
  })
}
