import type { Agent, AgentEventListener } from '@apeira/core'

import { assistant, createAgent, developer, mem, run, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { describe, expect, it, vi } from 'vitest'

import { compact } from '../src/index'
import { createMockFetch } from './_shared'

describe('compact plugin', () => {
  it('fails fast when prepareStep runs before plugin initialization', async () => {
    const plugin = compact({
      compactAgent: {
        runner: responses({
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: createMockFetch().fetch,
          model: 'compact-model',
        }),
      },
      threshold: 0,
    })

    await expect(plugin.prepareStep?.({
      input: [user('live')],
      model: 'main-model',
      stepNumber: 0,
      steps: [],
    })).rejects.toThrow('[@apeira/plugin-compact] Plugin is not initialized.')
  })

  it('compacts on the next turn after usage crosses threshold', async () => {
    const main = createMockFetch({ responseText: ['first', 'second'], totalTokens: [950, 2] })
    const summarizer = createMockFetch({ responseText: 'checkpoint summary' })

    const agent = createAgent({
      instructions: 'main',
      plugins: [
        compact({
          compactAgent: {
            runner: responses({
              apiKey: 'test',
              baseURL: 'https://test',
              fetch: summarizer.fetch,
              model: 'compact-model',
            }),
          },
          preserveTurns: 1,
          threshold: 0.9,
        }),
      ],
      runner: responses({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'main-model',
      }),
      state: { contextLength: 1000 },
      store: mem([
        user('old one'),
        assistant('old answer one'),
        user('old two'),
        assistant('old answer two'),
      ]),
    })

    for await (const event of run(agent, user('trigger compact')))
      void event

    expect(summarizer.bodies).toHaveLength(0)

    for await (const event of run(agent, user('after compact')))
      void event

    expect(summarizer.bodies).toHaveLength(1)
    expect(main.bodies[1]?.input).toEqual([
      user('old one'),
      user('old two'),
      developer('<context_summary>\ncheckpoint summary\n</context_summary>'),
      user('trigger compact'),
      assistant('first'),
      user('after compact'),
    ])
    expect(await agent.store.read()).toEqual([
      user('old one'),
      user('old two'),
      developer('<context_summary>\ncheckpoint summary\n</context_summary>'),
      user('trigger compact'),
      assistant('first'),
      user('after compact'),
      assistant('second'),
    ])
  })

  it('falls back to hard truncation after three compact failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let listener: AgentEventListener | undefined
    const storeAppend = vi.fn()
    const storeClear = vi.fn()
    const historicalInput = [
      user('old'),
      assistant('old answer'),
      user('recent'),
      assistant('recent answer'),
    ]
    const plugin = compact({
      compactAgent: {
        runner: responses({
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: async () => {
            throw new Error('summarizer down')
          },
          model: 'compact-model',
        }),
      },
      preserveTurns: 1,
      threshold: 0.001,
    })

    const agent: Agent = {
      abort: () => {},
      clear: () => {},
      emit: () => {},
      getActiveTurnId: () => undefined,
      init: async () => {},
      interrupt: () => undefined,
      send: () => 'turn-test',
      state: { get: () => ({ contextLength: 1000 }), set: () => {}, update: () => {} },
      stop: async () => {},
      store: {
        append: storeAppend,
        clear: storeClear,
        read: () => historicalInput,
        reset: () => {},
      },
      // @ts-expect-error wrong types
      subscribe: (_channel: string, nextListener: AgentEventListener) => {
        listener = nextListener
        return () => {}
      },
    }

    await plugin.init?.(agent)

    let result
    for (let i = 0; i < 3; i++) {
      await listener?.({ turnId: `turn-${i}`, type: 'turn.start' })
      result = await plugin.prepareStep?.({
        input: [...historicalInput, user('live')],
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
    expect(storeClear).toHaveBeenCalled()
    expect(storeAppend).toHaveBeenLastCalledWith(
      {
        content: '(Earlier conversation omitted due to length)',
        role: 'developer',
        type: 'message',
      },
      user('recent'),
      assistant('recent answer'),
    )
    warn.mockRestore()
  })

  it('reuses the parent agent runner when compactAgent.runner is omitted', async () => {
    const main = createMockFetch({ responseText: ['first', 'checkpoint summary', 'second'], totalTokens: [950, 2, 2] })

    const agent = createAgent({
      instructions: 'main',
      plugins: [
        compact({
          compactAgent: {},
          preserveTurns: 1,
          threshold: 0.9,
        }),
      ],
      runner: responses({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'main-model',
      }),
      state: { contextLength: 1000 },
      store: mem([
        user('old one'),
        assistant('old answer one'),
        user('old two'),
        assistant('old answer two'),
      ]),
    })

    for await (const event of run(agent, user('trigger compact')))
      void event

    expect(main.bodies).toHaveLength(1)

    for await (const event of run(agent, user('after compact')))
      void event

    expect(main.bodies).toHaveLength(3)
    expect(main.bodies[1]?.input).toContainEqual(assistant('old answer one'))
    expect(main.bodies[1]?.input).toContainEqual(user('Summarize the conversation.'))
    expect(main.bodies[2]?.input).toEqual([
      user('old one'),
      user('old two'),
      developer('<context_summary>\ncheckpoint summary\n</context_summary>'),
      user('trigger compact'),
      assistant('first'),
      user('after compact'),
    ])
  })

  it('keeps all live input items out of the compacted historical region', async () => {
    const summarizer = createMockFetch({ responseText: 'multi-live summary' })
    const historicalInput = [
      user('old one'),
      assistant('old answer one'),
      user('old two'),
      assistant('old answer two'),
    ]
    const storeAppend = vi.fn()
    const storeClear = vi.fn()
    const plugin = compact({
      compactAgent: {
        runner: responses({
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: summarizer.fetch,
          model: 'compact-model',
        }),
      },
      preserveTurns: 1,
      threshold: 0.001,
    })

    const agent: Agent = {
      abort: () => {},
      clear: () => {},
      emit: () => {},
      getActiveTurnId: () => undefined,
      init: async () => {},
      interrupt: () => undefined,
      send: () => 'turn-test',
      state: { get: () => ({ contextLength: 1000 }), set: () => {}, update: () => {} },
      stop: async () => {},
      store: {
        append: storeAppend,
        clear: storeClear,
        read: () => historicalInput,
        reset: () => {},
      },
      subscribe: () => () => {},
    }

    await plugin.init?.(agent)

    const result = await plugin.prepareStep?.({
      input: [
        ...historicalInput,
        user('live one'),
        user('live two'),
      ],
      model: 'main-model',
      stepNumber: 0,
      steps: [],
    })

    expect(summarizer.bodies[0]?.input).not.toContainEqual(user('live one'))
    expect(summarizer.bodies[0]?.input).not.toContainEqual(user('live two'))
    expect(result?.input?.slice(-2)).toEqual([
      user('live one'),
      user('live two'),
    ])
    expect(storeClear).toHaveBeenCalled()
    expect(storeAppend).toHaveBeenCalledWith(
      user('old one'),
      developer('<context_summary>\nmulti-live summary\n</context_summary>'),
      user('old two'),
      assistant('old answer two'),
    )
  })
})
