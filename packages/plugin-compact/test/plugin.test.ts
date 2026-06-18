import type { AgentEntry } from '@apeira/core'

import { assistant, createAgent, developer, entry, mem, run, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_COMPACTION_TRIGGER } from '../src/constants'
import { compact, transformCompactEntries } from '../src/index'
import { createMockFetch } from './_shared'

describe('compact projection', () => {
  it('returns the same history when no compact entry exists', () => {
    const entries = [entry('input', user('old'))]

    expect(transformCompactEntries(entries)).toBe(entries)
  })

  it('uses the latest compact entry without mutating history', () => {
    const entries: AgentEntry[] = [
      entry('input', user('old')),
      entry('compact', { summary: 'first summary' }),
      entry('input', user('between')),
      entry('compact', { summary: 'latest summary' }),
      entry('input', assistant('recent')),
    ]
    const snapshot = structuredClone(entries)
    const latest = entries[3]

    expect(transformCompactEntries(entries)).toEqual([
      {
        ...latest,
        data: developer('<context_summary>\nlatest summary\n</context_summary>'),
        type: 'input',
      },
      entries[4],
    ])
    expect(entries).toEqual(snapshot)
  })
})

describe('compact plugin', () => {
  it('fails fast when onTurnFinish runs before plugin initialization', async () => {
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

    await expect(plugin.onTurnFinish?.({
      input: [user('live')],
      output: [],
      turnId: 'turn',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    })).rejects.toThrow('[@apeira/plugin-compact] Plugin is not initialized.')
  })

  it('does nothing below the threshold', async () => {
    const main = createMockFetch({ responseText: 'first', totalTokens: 899 })
    const summarizer = createMockFetch({ responseText: 'summary' })
    const agent = createAgent({
      initialState: { contextLength: 1000 },
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
          threshold: 0.9,
        }),
      ],
      runner: responses({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'main-model',
      }),
    })

    for await (const event of run(agent, user('below threshold')))
      void event
    await agent.wait()

    expect(summarizer.bodies).toHaveLength(0)
    expect((await agent.storage.read()).some(item => item.type === 'compact')).toBe(false)
  })

  it('appends one compact entry after the triggering turn and projects it on the next turn', async () => {
    const main = createMockFetch({ responseText: ['first', 'second'], totalTokens: [950, 2] })
    const summarizer = createMockFetch({ responseText: 'checkpoint summary' })
    const agent = createAgent({
      initialState: { contextLength: 1000 },
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
          threshold: 0.9,
        }),
      ],
      runner: responses({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'main-model',
      }),
      storage: mem([
        user('old'),
        assistant('old answer'),
      ]),
    })

    for await (const event of run(agent, user('trigger compact')))
      void event
    await agent.wait()

    expect(summarizer.bodies).toHaveLength(1)
    expect(summarizer.bodies[0]?.input).toEqual([
      user('old'),
      assistant('old answer'),
      user('trigger compact'),
      assistant('first'),
      user(DEFAULT_COMPACTION_TRIGGER),
    ])

    const compactEntries = (await agent.storage.read())
      .filter((item): item is AgentEntry<'compact'> => item.type === 'compact')
    expect(compactEntries).toHaveLength(1)
    expect(compactEntries[0]?.data).toEqual({ summary: 'checkpoint summary' })
    expect(await agent.storage.read()).not.toContainEqual(expect.objectContaining({
      data: developer('<context_summary>\ncheckpoint summary\n</context_summary>'),
      type: 'input',
    }))

    for await (const event of run(agent, user('after compact')))
      void event
    await agent.wait()

    expect(main.bodies[1]?.input).toEqual([
      developer('<context_summary>\ncheckpoint summary\n</context_summary>'),
      user('after compact'),
    ])
  })

  it('summarizes only the previous compact projection on later compactions', async () => {
    const main = createMockFetch({ responseText: 'fresh answer', totalTokens: 950 })
    const summarizer = createMockFetch({ responseText: 'new summary' })
    const agent = createAgent({
      initialState: { contextLength: 1000 },
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
          threshold: 0.9,
        }),
      ],
      runner: responses({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'main-model',
      }),
      storage: mem([
        entry('input', user('covered raw history')),
        entry('compact', { summary: 'previous summary' }),
        entry('input', user('recent history')),
      ]),
    })

    for await (const event of run(agent, user('trigger again')))
      void event
    await agent.wait()

    expect(summarizer.bodies[0]?.input).toEqual([
      developer('<context_summary>\nprevious summary\n</context_summary>'),
      user('recent history'),
      user('trigger again'),
      assistant('fresh answer'),
      user(DEFAULT_COMPACTION_TRIGGER),
    ])
    expect(summarizer.bodies[0]?.input).not.toContainEqual(user('covered raw history'))
    expect((await agent.storage.read()).filter(item => item.type === 'compact')).toHaveLength(2)
  })

  it('does not include input from the next turn in the previous turn compaction', async () => {
    let releaseSummary!: () => void
    let signalSummaryStarted!: () => void
    const summaryBlocked = new Promise<void>(resolve => releaseSummary = resolve)
    const summaryStarted = new Promise<void>(resolve => signalSummaryStarted = resolve)
    const summarizer = createMockFetch({ responseText: 'summary' })
    const summaryFetch: typeof fetch = async (...args) => {
      signalSummaryStarted()
      await summaryBlocked
      return summarizer.fetch(...args)
    }
    const runnerInputs: unknown[][] = []
    const agent = createAgent({
      initialState: { contextLength: 1000 },
      instructions: '',
      plugins: [
        compact({
          compactAgent: {
            runner: responses({
              apiKey: 'test',
              baseURL: 'https://test',
              fetch: summaryFetch,
              model: 'compact-model',
            }),
          },
          threshold: 0,
        }),
      ],
      runner: async (context) => {
        runnerInputs.push([...context.input])
        return {
          output: [assistant(`answer ${runnerInputs.length}`)],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        }
      },
    })

    const first = (async () => {
      for await (const event of run(agent, user('first turn')))
        void event
    })()
    await summaryStarted
    agent.send(user('next turn'))
    expect(runnerInputs).toHaveLength(1)

    releaseSummary()
    await first
    await agent.wait()

    expect(summarizer.bodies[0]?.input).not.toContainEqual(user('next turn'))
    expect(runnerInputs).toHaveLength(2)
  })

  it('appends hard truncation only after three consecutive compact failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const historicalEntries = [
      entry('input', user('old')),
      entry('input', assistant('old answer')),
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
      threshold: 0,
    })
    const storage = mem(historicalEntries)
    const storeAppend = vi.spyOn(storage, 'append')
    const agent = createAgent({
      initialState: { contextLength: 1000 },
      instructions: '',
      runner: async () => ({ output: [] }),
      storage,
    })

    await plugin.init?.(agent)

    for (let i = 0; i < 3; i++) {
      await plugin.onTurnFinish?.({
        input: [user('live')],
        output: [],
        turnId: `turn-${i}`,
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      })
    }

    expect(storeAppend).toHaveBeenCalledOnce()
    expect(storeAppend).toHaveBeenCalledWith(expect.objectContaining({
      data: { summary: '(Earlier conversation omitted due to length)' },
      type: 'compact',
    }))
    warn.mockRestore()
  })

  it('reuses the parent agent runner when compactAgent.runner is omitted', async () => {
    const main = createMockFetch({
      responseText: ['first', 'checkpoint summary', 'second'],
      totalTokens: [950, 2, 2],
    })
    const agent = createAgent({
      initialState: { contextLength: 1000 },
      instructions: 'main',
      plugins: [
        compact({
          compactAgent: {},
          threshold: 0.9,
        }),
      ],
      runner: responses({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'main-model',
      }),
      storage: mem([user('old'), assistant('old answer')]),
    })

    for await (const event of run(agent, user('trigger compact')))
      void event
    await agent.wait()

    expect(main.bodies).toHaveLength(2)
    expect(main.bodies[1]?.input).toContainEqual(user(DEFAULT_COMPACTION_TRIGGER))

    for await (const event of run(agent, user('after compact')))
      void event
    await agent.wait()

    expect(main.bodies[2]?.input).toEqual([
      developer('<context_summary>\ncheckpoint summary\n</context_summary>'),
      user('after compact'),
    ])
  })
})
