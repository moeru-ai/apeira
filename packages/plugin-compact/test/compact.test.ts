import { describe, expect, it } from 'vitest'

import { executeCompact, hardTruncateInput } from '../src/index'
import { assistantMessage, createMockFetch, userMessage } from './_shared'

describe('executeCompact', () => {
  it('summarizes compressible history and assembles retained users, summary, and preserved turns', async () => {
    const mock = createMockFetch({ responseText: 'summary text' })
    const input = [
      userMessage('old request'),
      assistantMessage('old answer'),
      userMessage('recent request'),
      assistantMessage('recent answer'),
    ]

    const result = await executeCompact({
      compactAgent: {
        options: {
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: mock.fetch,
          model: 'compact-model',
        },
      },
      contextLength: 1000,
      input,
      maxRetainedUserTokens: 100,
      preserveTurns: 1,
    })

    expect(result.summary).toBe('summary text')
    expect(result.input).toEqual([
      userMessage('old request'),
      userMessage('[Context Summary]\nsummary text'),
      userMessage('recent request'),
      assistantMessage('recent answer'),
    ])
    expect(mock.bodies[0]?.input).toEqual([assistantMessage('old answer'), userMessage('Summarize the conversation.')])
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
        options: {
          apiKey: 'test',
          baseURL: 'https://test',
          fetch: mock.fetch,
          model: 'compact-model',
        },
      },
      contextLength: 1000,
      input: [
        userMessage('old request'),
        assistantMessage('old answer'),
        userMessage('recent request'),
      ],
      maxRetainedUserTokens: 100,
      preserveTurns: 1,
    })).rejects.toThrow('Compaction summary was refused.')
  })
})

describe('hardTruncateInput', () => {
  it('replaces compressible history with a developer placeholder', () => {
    const input = [
      userMessage('old'),
      assistantMessage('old answer'),
      userMessage('recent'),
      assistantMessage('recent answer'),
    ]

    expect(hardTruncateInput(input, 1, 1000)).toEqual([
      {
        content: '(Earlier conversation omitted due to length)',
        role: 'developer',
        type: 'message',
      },
      userMessage('recent'),
      assistantMessage('recent answer'),
    ])
  })
})
