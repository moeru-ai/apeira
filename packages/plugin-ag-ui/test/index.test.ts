import type { AgentEvent, AgentPluginApi } from '@apeira/core'

import { EventType } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { agui } from '../src/index'

const createPluginApi = () => {
  const emitted: Array<{ channel: string, event: unknown }> = []

  const api: AgentPluginApi = {
    emit: (channel, event) => {
      emitted.push({ channel, event })
    },
    subscribe: () => () => true,
  }

  return { api, emitted }
}

describe('agui', () => {
  it('maps run, step, and text events to AG-UI events', async () => {
    const received: unknown[] = []
    const plugin = agui({
      onEvent: event => received.push(event),
    })
    const { api, emitted } = createPluginApi()

    await plugin.setup?.(api)

    await plugin.onEvent?.({ sessionId: 'session-1', turnId: 'turn-1', type: 'turn.start' })
    await plugin.onEvent?.({ sessionId: 'session-1', turnId: 'turn-1', type: 'step.start' })
    await plugin.onEvent?.({ outputIndex: 0, sessionId: 'session-1', turnId: 'turn-1', type: 'text.start' })
    await plugin.onEvent?.({ delta: 'Hello', sessionId: 'session-1', turnId: 'turn-1', type: 'text.delta' })
    await plugin.onEvent?.({ sessionId: 'session-1', text: 'Hello', turnId: 'turn-1', type: 'text.done' })
    await plugin.onEvent?.({ output: [], sessionId: 'session-1', turnId: 'turn-1', type: 'step.done' })
    await plugin.onEvent?.({ sessionId: 'session-1', turnId: 'turn-1', type: 'turn.done' })

    expect(emitted.map(entry => entry.channel)).toEqual([
      'ag-ui',
      'ag-ui',
      'ag-ui',
      'ag-ui',
      'ag-ui',
      'ag-ui',
      'ag-ui',
    ])
    expect(emitted.map(entry => (entry.event as { type: string }).type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STEP_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.STEP_FINISHED,
      EventType.RUN_FINISHED,
    ])
    expect(received).toHaveLength(7)
  })

  it('maps tool, reasoning, and failure events with stable ids', async () => {
    const plugin = agui()
    const { api, emitted } = createPluginApi()

    await plugin.setup?.(api)

    await plugin.onEvent?.({ sessionId: 'session-1', turnId: 'turn-2', type: 'turn.start' })
    await plugin.onEvent?.({ outputIndex: 0, sessionId: 'session-1', turnId: 'turn-2', type: 'text.start' })
    await plugin.onEvent?.({
      outputIndex: 1,
      sessionId: 'session-1',
      toolCall: { id: 'call_1', name: 'weather' },
      turnId: 'turn-2',
      type: 'tool-call.start',
    })
    await plugin.onEvent?.({ delta: '{"city":"Taipei"}', sessionId: 'session-1', turnId: 'turn-2', type: 'tool-call.delta' })
    await plugin.onEvent?.({
      sessionId: 'session-1',
      toolCall: { arguments: '{"city":"Taipei"}', id: 'call_1', name: 'weather' },
      turnId: 'turn-2',
      type: 'tool-call.done',
    })
    await plugin.onEvent?.({
      sessionId: 'session-1',
      toolResult: { id: 'call_1', name: 'weather', output: { forecast: 'sunny' } },
      turnId: 'turn-2',
      type: 'tool-result.done',
    })
    await plugin.onEvent?.({ outputIndex: 0, sessionId: 'session-1', turnId: 'turn-2', type: 'reasoning.start' })
    await plugin.onEvent?.({ delta: 'Thinking', sessionId: 'session-1', turnId: 'turn-2', type: 'reasoning.delta' })
    await plugin.onEvent?.({ sessionId: 'session-1', text: 'Thinking', turnId: 'turn-2', type: 'reasoning.done' })
    await plugin.onEvent?.({ error: new Error('boom'), sessionId: 'session-1', turnId: 'turn-2', type: 'turn.failed' })

    const events = emitted.map(entry => entry.event as { [key: string]: unknown, type: string })

    expect(events.map(event => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.REASONING_START,
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
      EventType.RUN_ERROR,
    ])
    expect(events[2]).toMatchObject({
      parentMessageId: '["turn-2","text",0]',
      toolCallId: 'call_1',
      toolCallName: 'weather',
    })
    expect(events[3]).toMatchObject({
      delta: '{"city":"Taipei"}',
      toolCallId: 'call_1',
    })
    expect(events[5]).toMatchObject({
      content: JSON.stringify({ forecast: 'sunny' }),
      messageId: '["turn-2","tool-result","call_1"]',
      toolCallId: 'call_1',
    })
    expect(events[11]).toMatchObject({
      code: 'turn_failed',
      message: 'boom',
    })
  })

  it('maps HITL interruption to a review tool result', async () => {
    const plugin = agui()
    const { api, emitted } = createPluginApi()

    await plugin.setup?.(api)

    await plugin.onEvent?.({ sessionId: 'session-1', turnId: 'turn-3', type: 'turn.start' })
    await plugin.onEvent?.({ outputIndex: 0, sessionId: 'session-1', turnId: 'turn-3', type: 'text.start' })
    await plugin.onEvent?.({
      outputIndex: 1,
      sessionId: 'session-1',
      toolCall: { id: 'call_2', name: 'weather' },
      turnId: 'turn-3',
      type: 'tool-call.start',
    })
    await plugin.onEvent?.({
      interruption: {
        id: 'hitl_call_2',
        reason: 'Human review required.',
        toolCall: {
          args: '{"city":"Taipei"}',
          toolCallId: 'call_2',
          toolCallType: 'function',
          toolName: 'weather',
        },
      },
      sessionId: 'session-1',
      turnId: 'turn-3',
      type: 'tool-interruption',
    } satisfies AgentEvent)

    const events = emitted.map(entry => entry.event as { [key: string]: unknown, type: string })

    expect(events.map(event => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_RESULT,
    ])
    expect(events[3]).toMatchObject({
      content: [
        'HITL_REVIEW_REQUIRED',
        'id=hitl_call_2',
        'tool=weather',
        'args={"city":"Taipei"}',
        'reason=Human review required.',
      ].join('\n'),
      toolCallId: 'call_2',
    })
  })

  it('does not emit tool-call end when HITL interruption follows tool-call done', async () => {
    const plugin = agui()
    const { api, emitted } = createPluginApi()

    await plugin.setup?.(api)

    await plugin.onEvent?.({ sessionId: 'session-1', turnId: 'turn-4', type: 'turn.start' })
    await plugin.onEvent?.({
      outputIndex: 1,
      sessionId: 'session-1',
      toolCall: { id: 'call_3', name: 'weather' },
      turnId: 'turn-4',
      type: 'tool-call.start',
    })
    await plugin.onEvent?.({
      sessionId: 'session-1',
      toolCall: { arguments: '{"city":"Taipei"}', id: 'call_3', name: 'weather' },
      turnId: 'turn-4',
      type: 'tool-call.done',
    })
    await plugin.onEvent?.({
      interruption: {
        id: 'hitl_call_3',
        reason: 'Human review required.',
        toolCall: {
          args: '{"city":"Taipei"}',
          toolCallId: 'call_3',
          toolCallType: 'function',
          toolName: 'weather',
        },
      },
      sessionId: 'session-1',
      turnId: 'turn-4',
      type: 'tool-interruption',
    } satisfies AgentEvent)

    const events = emitted.map(entry => entry.event as { type: string })

    expect(events.map(event => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
    ])
  })
})
