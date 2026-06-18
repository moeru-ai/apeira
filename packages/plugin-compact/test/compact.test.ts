import { assistant, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { describe, expect, it } from 'vitest'

import { DEFAULT_COMPACTION_TRIGGER } from '../src/constants'
import { executeCompact } from '../src/index'
import { createMockFetch } from './_shared'

describe('executeCompact', () => {
  it('summarizes the full input and returns the assistant summary', async () => {
    const mock = createMockFetch({ responseText: 'summary text' })
    const input = [
      user('old request'),
      assistant('old answer'),
      user('recent request'),
      assistant('recent answer'),
    ]

    const summary = await executeCompact({
      compactAgent: {
        runner: responses({
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: mock.fetch,
          model: 'compact-model',
        }),
      },
      input,
    })

    expect(summary).toBe('summary text')
    expect(mock.bodies[0]?.input).toEqual([
      user('old request'),
      assistant('old answer'),
      user('recent request'),
      assistant('recent answer'),
      user(DEFAULT_COMPACTION_TRIGGER),
    ])
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
      input: [
        user('old request'),
        assistant('old answer'),
        user('recent request'),
      ],
    })).rejects.toThrow('Compaction summary was refused.')
  })
})
