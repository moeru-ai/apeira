import type { AgentEvent, AgentInput, RunnerContext } from '../../src/index'

import { stepCountAtLeast } from '@xsai/shared-chat'
import { describe, expect, it } from 'vitest'

import { chat, createAgent, responses, run } from '../../src/index'
import { createAgentChannel } from '../../src/utils/channel'
import { user } from '../../src/index'
import { createMockFetch } from '../_shared'

const createRunnerContext = (
  input: AgentInput[],
  overrides: Partial<RunnerContext> = {},
): RunnerContext => ({
  channel: createAgentChannel(),
  input,
  instructions: 'system instructions',
  tools: [],
  turnId: 'turn-1',
  ...overrides,
})

const createChatMockFetch = (toolCall = false) => {
  const bodies: Array<{ messages: unknown[], tools?: unknown[] }> = []

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as { messages: unknown[], tools?: unknown[] })

    const encoder = new TextEncoder()
    const chunk = {
      choices: [{
        delta: toolCall
          ? {
              role: 'assistant',
              tool_calls: [{
                function: { arguments: '{}', name: 'test-tool' },
                id: 'call-1',
                index: 0,
                type: 'function',
              }],
            }
          : { content: 'hello', role: 'assistant' },
        finish_reason: toolCall ? 'tool_calls' : 'stop',
        index: 0,
      }],
      created: 0,
      id: 'chat-1',
      model: 'test-model',
      object: 'chat.completion.chunk',
      system_fingerprint: '',
    }

    return new Response(new ReadableStream({
      start: (controller) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  }

  return { bodies, fetch }
}

describe('responses', () => {
  it('converts input and returns Responses output', async () => {
    const mock = createMockFetch()
    const runner = responses({
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
      stopWhen: stepCountAtLeast(1),
    })

    const result = await runner(createRunnerContext([user('hi')]))

    expect(mock.bodies[0]?.instructions).toBe('system instructions')
    expect(result.output).toEqual([{
      content: [{ text: 'hello', type: 'output_text' }],
      role: 'assistant',
      type: 'message',
    }])
  })
})

describe('chat', () => {
  it('runs through createAgent and persists Chat output', async () => {
    const mock = createChatMockFetch()
    const agent = createAgent({
      instructions: 'system instructions',
      runner: chat({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: mock.fetch,
        model: 'test-model',
        stopWhen: stepCountAtLeast(1),
      }),
    })

    for await (const event of run(agent, user('hi')))
      void event

    expect(agent.getInput()).toEqual([
      user('hi'),
      expect.objectContaining({
        content: 'hello',
        role: 'assistant',
        type: 'message',
      }),
    ])
  })

  it('injects instructions, forwards events, and returns embedded Chat output', async () => {
    const mock = createChatMockFetch()
    const channel = createAgentChannel()
    const events: AgentEvent[] = []
    channel.subscribe('apeira', event => events.push(event))
    const runner = chat({
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
      stopWhen: stepCountAtLeast(1),
    })

    const result = await runner(createRunnerContext([user('hi')], { channel }))

    expect(mock.bodies[0]?.messages).toEqual([
      { content: 'system instructions', role: 'system' },
      { content: 'hi', role: 'user' },
    ])
    expect(result.output).toEqual([{
      content: 'hello',
      reasoning: undefined,
      reasoning_content: undefined,
      refusal: undefined,
      role: 'assistant',
      tool_calls: undefined,
      type: 'message',
    }])
    expect(events).toContainEqual({
      delta: 'hello',
      turnId: 'turn-1',
      type: 'text.delta',
    })
  })

  it('adapts prepareStep through AgentInput', async () => {
    const mock = createChatMockFetch()
    const runner = chat({
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
      stopWhen: stepCountAtLeast(1),
    })

    await runner(createRunnerContext([user('original')], {
      prepareStep: ({ input }) => {
        expect(input).toEqual([user('original')])
        return { input: [...input, user('temporary')] }
      },
    }))

    expect(mock.bodies[0]?.messages).toEqual([
      { content: 'system instructions', role: 'system' },
      { content: 'original', role: 'user' },
      { content: 'temporary', role: 'user' },
    ])
  })

  it('keeps Chat tool calls embedded without duplicate standalone input', async () => {
    const mock = createChatMockFetch(true)
    const runner = chat({
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
      stopWhen: stepCountAtLeast(1),
    })

    const result = await runner(createRunnerContext([user('hi')], {
      tools: [{
        execute: () => 'tool result',
        function: { name: 'test-tool', parameters: {} },
        type: 'function',
      }],
    }))

    expect(result.output).toEqual([
      expect.objectContaining({
        role: 'assistant',
        tool_calls: [expect.objectContaining({ id: 'call-1' })],
        type: 'message',
      }),
      {
        call_id: 'call-1',
        output: 'tool result',
        type: 'function_call_output',
      },
    ])
    expect(result.output).not.toContainEqual(expect.objectContaining({
      type: 'function_call',
    }))
  })
})
