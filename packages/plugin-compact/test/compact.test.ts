import { assistant, developer, responses, user } from '@apeira/core'
import { describe, expect, it } from 'vitest'

import { executeCompact, hardTruncateInput } from '../src/index'
import { createMockFetch } from './_shared'

describe('executeCompact', () => {
  it('summarizes compressible history and assembles retained users, summary, and preserved turns', async () => {
    const mock = createMockFetch({ responseText: 'summary text' })
    const input = [
      user('old request'),
      assistant('old answer'),
      user('recent request'),
      assistant('recent answer'),
    ]

    const result = await executeCompact({
      compactAgent: {
        runner: responses({
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: mock.fetch,
          model: 'compact-model',
        }),
      },
      contextLength: 1000,
      input,
      maxRetainedUserTokens: 100,
      preserveTurns: 1,
    })

    expect(result.summary).toBe('summary text')
    expect(result.input).toEqual([
      user('old request'),
      developer('<context_summary>\nsummary text\n</context_summary>'),
      user('recent request'),
      assistant('recent answer'),
    ])
    expect(mock.bodies[0]?.input).toEqual([assistant('old answer'), user('Summarize the conversation.')])
  })

  it('treats summarizer refusal as a compact failure', async () => {
    const mock = createMockFetch({
      responseItem: {
        content: [{ refusal: 'cannot summarize', type: 'refusal' }],
        role: 'assistant',
        type: 'message',
      },
    })

    await expect(executeCompact({
      compactAgent: {
        runner: responses({
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: mock.fetch,
          model: 'compact-model',
        }),
      },
      contextLength: 1000,
      input: [
        user('old request'),
        assistant('old answer'),
        user('recent request'),
      ],
      maxRetainedUserTokens: 100,
      preserveTurns: 1,
    })).rejects.toThrow('Compaction summary was refused.')
  })
})

describe('hardTruncateInput', () => {
  it('replaces compressible history with a developer placeholder', () => {
    const input = [
      user('old'),
      assistant('old answer'),
      user('recent'),
      assistant('recent answer'),
    ]

    expect(hardTruncateInput(input, 1, 1000)).toEqual([
      {
        content: '(Earlier conversation omitted due to length)',
        role: 'developer',
        type: 'message',
      },
      user('recent'),
      assistant('recent answer'),
    ])
  })
})
