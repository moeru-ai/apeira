import type { Agent, AgentEventListener } from '@apeira/core'

import { createAgent, run } from '@apeira/core'
import { describe, expect, it, vi } from 'vitest'

import { compact } from '../src/index'
import { assistantMessage, createMockFetch, userMessage } from './_shared'

describe('compact plugin', () => {
  it('fails fast when prepareStep runs before plugin initialization', async () => {
    const plugin = compact({
      compactAgent: {
        options: {
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: createMockFetch().fetch,
          model: 'compact-model',
        },
      },
      threshold: 0,
    })

    await expect(plugin.prepareStep?.({
      input: [userMessage('live')],
      model: 'main-model',
      stepNumber: 0,
      steps: [],
    })).rejects.toThrow('[@apeira/plugin-compact] Plugin is not initialized.')
  })

  it('compacts on the next turn after usage crosses threshold', async () => {
    const main = createMockFetch({ responseText: ['first', 'second'], totalTokens: [950, 2] })
    const summarizer = createMockFetch({ responseText: 'checkpoint summary' })

    const agent = createAgent({
      input: [
        userMessage('old one'),
        assistantMessage('old answer one'),
        userMessage('old two'),
        assistantMessage('old answer two'),
      ],
      instructions: 'main',
      options: {
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'main-model',
      },
      plugins: [
        compact({
          compactAgent: {
            options: {
              apiKey: 'test',
              baseURL: 'https://test',
              fetch: summarizer.fetch,
              model: 'compact-model',
            },
          },
          preserveTurns: 1,
          threshold: 0.9,
        }),
      ],
      state: { contextLength: 1000 },
    })

    for await (const event of run(agent, userMessage('trigger compact')))
      void event

    expect(summarizer.bodies).toHaveLength(0)

    for await (const event of run(agent, userMessage('after compact')))
      void event

    expect(summarizer.bodies).toHaveLength(1)
    expect(main.bodies[1]?.input).toEqual([
      userMessage('old one'),
      userMessage('old two'),
      userMessage('[Context Summary]\ncheckpoint summary'),
      userMessage('trigger compact'),
      assistantMessage('first'),
      userMessage('after compact'),
    ])
    expect(agent.getInput()).toEqual([
      userMessage('old one'),
      userMessage('old two'),
      userMessage('[Context Summary]\ncheckpoint summary'),
      userMessage('trigger compact'),
      assistantMessage('first'),
      userMessage('after compact'),
      assistantMessage('second'),
    ])
  })

  it('falls back to hard truncation after three compact failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let listener: AgentEventListener | undefined
    const setInput = vi.fn()
    const historicalInput = [
      userMessage('old'),
      assistantMessage('old answer'),
      userMessage('recent'),
      assistantMessage('recent answer'),
    ]
    const plugin = compact({
      compactAgent: {
        options: {
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: async () => {
            throw new Error('summarizer down')
          },
          model: 'compact-model',
        },
      },
      preserveTurns: 1,
      threshold: 0.001,
    })

    const agent: Agent = {
      abort: () => {},
      clear: () => {},
      emit: () => {},
      getActiveTurnId: () => undefined,
      getInput: () => historicalInput,
      getState: () => ({ contextLength: 1000 }),
      init: async () => {},
      interrupt: () => undefined,
      remove: async () => {},
      send: () => 'turn-test',
      setInput,
      stop: async () => {},
      // @ts-expect-error wrong types
      subscribe: (_channel: string, nextListener: AgentEventListener) => {
        listener = nextListener
        return () => {}
      },
    }

    await plugin.init?.(agent)

    let result
    for (let i = 0; i < 3; i++) {
      listener?.({ turnId: `turn-${i}`, type: 'turn.start' })
      result = await plugin.prepareStep?.({
        input: [...historicalInput, userMessage('live')],
        model: 'main-model',
        stepNumber: 0,
        steps: [],
      })
    }

    expect(result?.input?.[0]).toEqual({
      content: '(Earlier conversation omitted due to length)',
      role: 'developer',
      type: 'message',
    })
    expect(setInput).toHaveBeenLastCalledWith([
      {
        content: '(Earlier conversation omitted due to length)',
        role: 'developer',
        type: 'message',
      },
      userMessage('recent'),
      assistantMessage('recent answer'),
    ])
    warn.mockRestore()
  })

  it('keeps all live input items out of the compacted historical region', async () => {
    const summarizer = createMockFetch({ responseText: 'multi-live summary' })
    const historicalInput = [
      userMessage('old one'),
      assistantMessage('old answer one'),
      userMessage('old two'),
      assistantMessage('old answer two'),
    ]
    const setInput = vi.fn()
    const plugin = compact({
      compactAgent: {
        options: {
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: summarizer.fetch,
          model: 'compact-model',
        },
      },
      preserveTurns: 1,
      threshold: 0.001,
    })

    const agent: Agent = {
      abort: () => {},
      clear: () => {},
      emit: () => {},
      getActiveTurnId: () => undefined,
      getInput: () => historicalInput,
      getState: () => ({ contextLength: 1000 }),
      init: async () => {},
      interrupt: () => undefined,
      remove: async () => {},
      send: () => 'turn-test',
      setInput,
      stop: async () => {},
      subscribe: () => () => {},
    }

    await plugin.init?.(agent)

    const result = await plugin.prepareStep?.({
      input: [
        ...historicalInput,
        userMessage('live one'),
        userMessage('live two'),
      ],
      model: 'main-model',
      stepNumber: 0,
      steps: [],
    })

    expect(summarizer.bodies[0]?.input).not.toContainEqual(userMessage('live one'))
    expect(summarizer.bodies[0]?.input).not.toContainEqual(userMessage('live two'))
    expect(result?.input?.slice(-2)).toEqual([
      userMessage('live one'),
      userMessage('live two'),
    ])
    expect(setInput).toHaveBeenCalledWith([
      userMessage('old one'),
      userMessage('[Context Summary]\nmulti-live summary'),
      userMessage('old two'),
      assistantMessage('old answer two'),
    ])
  })
})
