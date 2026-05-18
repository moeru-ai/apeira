import type { AgentPluginApi } from '@apeira/core'

import { EventType } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { AG_UI_CHANNEL, agui } from '../src/index'

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

    await plugin.onEvent?.({ threadId: 'thread-1', turnId: 'turn-1', type: 'turn.start' })
    await plugin.onEvent?.({ threadId: 'thread-1', turnId: 'turn-1', type: 'step.start' })
    await plugin.onEvent?.({ outputIndex: 0, threadId: 'thread-1', turnId: 'turn-1', type: 'text.start' })
    await plugin.onEvent?.({ delta: 'Hello', threadId: 'thread-1', turnId: 'turn-1', type: 'text.delta' })
    await plugin.onEvent?.({ text: 'Hello', threadId: 'thread-1', turnId: 'turn-1', type: 'text.done' })
    await plugin.onEvent?.({ output: [], threadId: 'thread-1', turnId: 'turn-1', type: 'step.done' })
    await plugin.onEvent?.({ threadId: 'thread-1', turnId: 'turn-1', type: 'turn.done' })

    expect(emitted.map(entry => entry.channel)).toEqual([
      AG_UI_CHANNEL,
      AG_UI_CHANNEL,
      AG_UI_CHANNEL,
      AG_UI_CHANNEL,
      AG_UI_CHANNEL,
      AG_UI_CHANNEL,
      AG_UI_CHANNEL,
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

    await plugin.onEvent?.({ threadId: 'thread-1', turnId: 'turn-2', type: 'turn.start' })
    await plugin.onEvent?.({ outputIndex: 0, threadId: 'thread-1', turnId: 'turn-2', type: 'text.start' })
    await plugin.onEvent?.({
      outputIndex: 1,
      threadId: 'thread-1',
      toolCall: { id: 'call_1', name: 'weather' },
      turnId: 'turn-2',
      type: 'tool-call.start',
    })
    await plugin.onEvent?.({ delta: '{"city":"Taipei"}', threadId: 'thread-1', turnId: 'turn-2', type: 'tool-call.delta' })
    await plugin.onEvent?.({
      threadId: 'thread-1',
      toolCall: { arguments: '{"city":"Taipei"}', id: 'call_1', name: 'weather' },
      turnId: 'turn-2',
      type: 'tool-call.done',
    })
    await plugin.onEvent?.({
      threadId: 'thread-1',
      toolResult: { id: 'call_1', name: 'weather', output: { forecast: 'sunny' } },
      turnId: 'turn-2',
      type: 'tool-result.done',
    })
    await plugin.onEvent?.({ outputIndex: 0, threadId: 'thread-1', turnId: 'turn-2', type: 'reasoning.start' })
    await plugin.onEvent?.({ delta: 'Thinking', threadId: 'thread-1', turnId: 'turn-2', type: 'reasoning.delta' })
    await plugin.onEvent?.({ text: 'Thinking', threadId: 'thread-1', turnId: 'turn-2', type: 'reasoning.done' })
    await plugin.onEvent?.({ error: new Error('boom'), threadId: 'thread-1', turnId: 'turn-2', type: 'turn.failed' })

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
})
