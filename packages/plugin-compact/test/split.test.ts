import { describe, expect, it } from 'vitest'

import {
  buildCompactInput,
  selectRetainedUserMessages,
  splitHistory,
} from '../src/index'
import { assistantMessage, userMessage } from './_shared'

describe('splitHistory', () => {
  it('splits before the requested user turn from the end', () => {
    const input = [
      userMessage('one'),
      assistantMessage('a1'),
      userMessage('two'),
      assistantMessage('a2'),
      userMessage('three'),
    ]

    const result = splitHistory(input, 2)

    expect(result.hasEnoughTurns).toBe(true)
    expect(result.compressible).toEqual([userMessage('one'), assistantMessage('a1')])
    expect(result.preserved).toEqual([userMessage('two'), assistantMessage('a2'), userMessage('three')])
  })

  it('marks histories with too few user turns as not compactable', () => {
    const input = [userMessage('one'), assistantMessage('a1')]

    const result = splitHistory(input, 2)

    expect(result.hasEnoughTurns).toBe(false)
  })
})

describe('selectRetainedUserMessages', () => {
  it('keeps most recent user messages within budget', () => {
    const input = [
      userMessage('old message'),
      assistantMessage('a1'),
      userMessage('new message'),
    ]

    expect(selectRetainedUserMessages(input, 3)).toEqual([
      { item: input[2], text: 'new message' },
    ])
  })

  it('partially truncates when only part of a message fits', () => {
    const input = [userMessage('abcdefghij')]

    expect(selectRetainedUserMessages(input, 1)).toEqual([
      { item: input[0], text: 'abcd' },
    ])
  })
})

describe('buildCompactInput', () => {
  it('removes retained user messages while preserving other items', () => {
    const input = [
      userMessage('keep as retained'),
      assistantMessage('still summarize'),
      userMessage('summarize too'),
    ]

    expect(buildCompactInput(input, [{ item: input[0], text: 'keep as retained' }])).toEqual([
      assistantMessage('still summarize'),
      userMessage('summarize too'),
    ])
  })

  it('removes a user message when the retained copy is a truncated prefix', () => {
    const input = [
      userMessage('abcdefghij'),
      assistantMessage('still summarize'),
    ]

    expect(buildCompactInput(input, [{ item: input[0], text: 'abcd' }])).toEqual([
      assistantMessage('still summarize'),
    ])
  })

  it('does not remove another user message with the same retained prefix', () => {
    const input = [
      userMessage('Please refactor auth'),
      assistantMessage('noted'),
      userMessage('Please update docs'),
    ]

    expect(buildCompactInput(input, [{ item: input[0], text: 'Please ' }])).toEqual([
      assistantMessage('noted'),
      userMessage('Please update docs'),
    ])
  })
})
