import type { AGUIEvent } from '@ag-ui/core'
import type { AgentPlugin, AgentPluginApi } from '@apeira/core'

import { EventType } from '@ag-ui/core'

import { name, version } from '../package.json'

export const AG_UI_CHANNEL = 'ag-ui'

export type AGUIEventListener = (event: AGUIEvent) => void

export interface AGUIPlugin extends AgentPlugin {
  subscribe: (listener: AGUIEventListener) => () => boolean
}

export interface AGUIPluginOptions {
  channel?: string
  onEvent?: AGUIEventListener
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

export const agui = (options: AGUIPluginOptions = {}): AGUIPlugin => {
  const channel = options.channel ?? AG_UI_CHANNEL
  const listeners = new Set<AGUIEventListener>()
  const turnStates = new Map<string, TurnState>()

  let pluginApi: AgentPluginApi | undefined

  const getTurnState = (turnId: string): TurnState => {
    const existing = turnStates.get(turnId)
    if (existing != null)
      return existing

    const created: TurnState = { stepIndex: 0 }
    turnStates.set(turnId, created)
    return created
  }

  const emit = (event: AGUIEvent) => {
    pluginApi?.emit(channel, event)
    options.onEvent?.(event)

    for (const listener of [...listeners])
      listener(event)
  }

  const cleanup = (turnId: string) => {
    turnStates.delete(turnId)
  }

  return ({
    name,
    onEvent: (event) => {
      // eslint-disable-next-line ts/switch-exhaustiveness-check
      switch (event.type) {
        case 'error': {
          emit({
            code: event.error.code ?? undefined,
            message: event.error.message,
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
          const messageId = createMessageId(event.turnId, 'reasoning', event.outputIndex)

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
          const messageId = createMessageId(event.turnId, 'text', event.outputIndex)

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
            toolCallId: event.toolCall.id,
            type: EventType.TOOL_CALL_END,
          })
          state.activeToolCallId = undefined
          return
        }

        case 'tool-call.start': {
          const state = getTurnState(event.turnId)
          state.activeToolCallId = event.toolCall.id

          emit({
            parentMessageId: state.lastAssistantMessageId,
            rawEvent: event,
            timestamp: Date.now(),
            toolCallId: event.toolCall.id,
            toolCallName: event.toolCall.name,
            type: EventType.TOOL_CALL_START,
          })
          return
        }

        case 'tool-result.done': {
          emit({
            content: JSON.stringify(event.toolResult.output),
            messageId: createMessageId(event.turnId, 'tool-result', event.toolResult.id),
            rawEvent: event,
            role: 'tool',
            timestamp: Date.now(),
            toolCallId: event.toolResult.id,
            type: EventType.TOOL_CALL_RESULT,
          })
          return
        }

        case 'turn.aborted': {
          emit({
            rawEvent: event,
            result: { reason: event.reason, status: 'aborted' },
            runId: event.turnId,
            threadId: event.threadId,
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
            threadId: event.threadId,
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
            threadId: event.threadId,
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
    },
    setup: (api) => {
      pluginApi = api
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    version,
  })
}
