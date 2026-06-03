import type { Agent } from '@apeira/core'

import { EventType } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'

import { agui } from '../src/index'

const createMockAgent = () => {
  const emitted: Array<{ channel: string, event: unknown }> = []
  const listeners = new Map<string, Array<(event: unknown) => void>>()

  return {
    emit: (channel: string, event: unknown) => {
      emitted.push({ channel, event })
      listeners.get(channel)?.forEach(l => l(event))
    },
    emitted,
    subscribe: (channel: string, listener: (event: unknown) => void) => {
      if (!listeners.has(channel))
        listeners.set(channel, [])
      listeners.get(channel)!.push(listener)
      return () => {
        const list = listeners.get(channel)
        if (list) {
          const idx = list.indexOf(listener)
          if (idx !== -1)
            list.splice(idx, 1)
        }
      }
    },
  } as unknown as (Agent & { emitted: Array<{ channel: string, event: unknown }> })
}

describe('agui', () => {
  it('maps run, step, and text events to AG-UI events', async () => {
    const plugin = agui({ threadId: 'thread-1' })
    const mockAgent = createMockAgent()
    const received: unknown[] = []
    mockAgent.subscribe('ag-ui', event => received.push(event))

    await plugin.init?.(mockAgent)

    mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })
    mockAgent.emit('apeira', { turnId: 'turn-1', type: 'step.start' })
    mockAgent.emit('apeira', { outputIndex: 0, turnId: 'turn-1', type: 'text.start' })
    mockAgent.emit('apeira', { delta: 'Hello', turnId: 'turn-1', type: 'text.delta' })
    mockAgent.emit('apeira', { text: 'Hello', turnId: 'turn-1', type: 'text.done' })
    mockAgent.emit('apeira', { output: [], turnId: 'turn-1', type: 'step.done' })
    mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.done' })

    const aguiEvents = mockAgent.emitted.filter(entry => entry.channel === 'ag-ui')
    expect(aguiEvents.map(entry => (entry.event as { type: string }).type)).toEqual([
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
    const plugin = agui({ threadId: 'thread-1' })
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)

    mockAgent.emit('apeira', { turnId: 'turn-2', type: 'turn.start' })
    mockAgent.emit('apeira', { outputIndex: 0, turnId: 'turn-2', type: 'text.start' })
    mockAgent.emit('apeira', {
      outputIndex: 1,
      toolCall: { id: 'call_1', name: 'weather' },
      turnId: 'turn-2',
      type: 'tool-call.start',
    })
    mockAgent.emit('apeira', { delta: '{"city":"Taipei"}', turnId: 'turn-2', type: 'tool-call.delta' })
    mockAgent.emit('apeira', {
      toolCall: { arguments: '{"city":"Taipei"}', id: 'call_1', name: 'weather' },
      turnId: 'turn-2',
      type: 'tool-call.done',
    })
    mockAgent.emit('apeira', {
      toolResult: { id: 'call_1', name: 'weather', output: { forecast: 'sunny' } },
      turnId: 'turn-2',
      type: 'tool-result.done',
    })
    mockAgent.emit('apeira', { outputIndex: 0, turnId: 'turn-2', type: 'reasoning.start' })
    mockAgent.emit('apeira', { delta: 'Thinking', turnId: 'turn-2', type: 'reasoning.delta' })
    mockAgent.emit('apeira', { text: 'Thinking', turnId: 'turn-2', type: 'reasoning.done' })
    mockAgent.emit('apeira', { error: new Error('boom'), turnId: 'turn-2', type: 'turn.failed' })

    const events = mockAgent.emitted
      .filter(entry => entry.channel === 'ag-ui')
      .map(entry => entry.event as { [key: string]: unknown, type: string })

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
