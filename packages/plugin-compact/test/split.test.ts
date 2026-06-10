import { assistant, user } from '@apeira/core'
import { describe, expect, it } from 'vitest'

import {
  buildCompactInput,
  selectRetainedUserMessages,
  splitHistory,
} from '../src/index'


describe('splitHistory', () => {
  it('splits before the requested user turn from the end', () => {
    const input = [
      user('one'),
      assistant('a1'),
      user('two'),
      assistant('a2'),
      user('three'),
    ]

    const result = splitHistory(input, 2)

    expect(result.hasEnoughTurns).toBe(true)
    expect(result.compressible).toEqual([user('one'), assistant('a1')])
    expect(result.preserved).toEqual([user('two'), assistant('a2'), user('three')])
  })

  it('marks histories with too few user turns as not compactable', () => {
    const input = [user('one'), assistant('a1')]

    const result = splitHistory(input, 2)

    expect(result.hasEnoughTurns).toBe(false)
  })
})

describe('selectRetainedUserMessages', () => {
  it('keeps most recent user messages within budget', () => {
    const input = [
      user('old message'),
      assistant('a1'),
      user('new message'),
    ]

    expect(selectRetainedUserMessages(input, 3)).toEqual([
      { item: input[2], text: 'new message' },
    ])
  })

  it('partially truncates when only part of a message fits', () => {
    const input = [user('abcdefghij')]

    expect(selectRetainedUserMessages(input, 1)).toEqual([])
  })
})

describe('buildCompactInput', () => {
  it('removes retained user messages while preserving other items', () => {
    const input = [
      user('keep as retained'),
      assistant('still summarize'),
      user('summarize too'),
    ]

    expect(buildCompactInput(input, [{ item: input[0], text: 'keep as retained' }])).toEqual([
      assistant('still summarize'),
      user('summarize too'),
    ])
  })

  it('removes a user message when the retained copy is a truncated prefix', () => {
    const input = [
      user('abcdefghij'),
      assistant('still summarize'),
    ]

    expect(buildCompactInput(input, [{ item: input[0], text: 'abcd' }])).toEqual([
      assistant('still summarize'),
    ])
  })

  it('does not remove another user message with the same retained prefix', () => {
    const input = [
      user('Please refactor auth'),
      assistant('noted'),
      user('Please update docs'),
    ]

    expect(buildCompactInput(input, [{ item: input[0], text: 'Please ' }])).toEqual([
      assistant('noted'),
      user('Please update docs'),
    ])
  })
})
