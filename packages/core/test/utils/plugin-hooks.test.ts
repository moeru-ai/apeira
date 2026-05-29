import type { Tool } from '@xsai/shared-chat'

import { describe, expect, it } from 'vitest'

import { createEpisodic } from '../../src/episodic'
import { resolveInstructions, resolveResponseHooks } from '../../src/utils/plugin-hooks'
import { message } from '../_shared'

const createMockSignal = () => new AbortController().signal

const baseHookOptions = () => ({
  agentName: 'test-agent',
  context: { locale: 'en' },
  sessionId: 'test-session',
  signal: createMockSignal(),
  turnId: 'turn-1',
  turnInput: message('hello'),
})

describe('resolveInstructions', () => {
  it('returns base instructions when no plugins extend them', async () => {
    const result = await resolveInstructions(
      { ...baseHookOptions(), plugins: [] },
      'base',
    )
    expect(result).toBe('base')
  })

  it('concatenates plugin extensions with double newline', async () => {
    const result = await resolveInstructions(
      {
        ...baseHookOptions(),
        plugins: [
          { extendInstructions: () => 'first extension', name: 'p1' },
          { extendInstructions: () => 'second extension', name: 'p2' },
        ],
      },
      'base',
    )
    expect(result).toBe('base\n\nfirst extension\n\nsecond extension')
  })

  it('skips null and empty extensions', async () => {
    const result = await resolveInstructions(
      {
        ...baseHookOptions(),
        plugins: [
          { extendInstructions: () => '', name: 'p1' },
          { extendInstructions: () => null as unknown as string, name: 'p2' },
          { extendInstructions: () => 'real', name: 'p3' },
        ],
      },
      'base',
    )
    expect(result).toBe('base\n\nreal')
  })

  it('passes turnInput and context to extendInstructions', async () => {
    const calls: unknown[] = []
    await resolveInstructions(
      {
        ...baseHookOptions(),
        plugins: [{
          extendInstructions: (opts) => {
            calls.push({ context: opts.context, turnInput: opts.turnInput })
            return 'ext'
          },
          name: 'p1',
        }],
      },
      'base',
    )
    expect(calls).toEqual([{
      context: { locale: 'en' },
      turnInput: message('hello'),
    }])
  })
})

describe('resolveResponseHooks', () => {
  it('returns empty extensions and undefined hooks with no plugins', async () => {
    const result = await resolveResponseHooks({
      ...baseHookOptions(),
      episodic: createEpisodic(),
      input: [message('hello')],
      plugins: [],
      responseOptions: {},
    })

    expect(result.extendInput).toEqual([])
    expect(result.tools).toBeUndefined()
    expect(result.onFinish).toBeUndefined()
    expect(result.onStepFinish).toBeUndefined()
    expect(result.postToolCall).toBeUndefined()
    expect(result.preToolCall).toBeUndefined()
    expect(result.prepareStep).toBeUndefined()
  })

  it('merges extendInput from multiple plugins', async () => {
    const result = await resolveResponseHooks({
      ...baseHookOptions(),
      episodic: createEpisodic(),
      input: [message('hello')],
      plugins: [
        { extendInput: () => [message('ext1')], name: 'p1' },
        { extendInput: () => [message('ext2')], name: 'p2' },
      ],
      responseOptions: {},
    })

    expect(result.extendInput).toEqual([message('ext1'), message('ext2')])
  })

  it('deduplicates tools by name across plugins', async () => {
    const toolA: Tool = {
      function: { name: 'tool-a', parameters: {} },
      type: 'function',
    }
    const toolB: Tool = {
      function: { name: 'tool-a', parameters: {} },
      type: 'function',
    }

    const result = await resolveResponseHooks({
      ...baseHookOptions(),
      episodic: createEpisodic(),
      input: [],
      plugins: [
        { extendTools: () => [toolA], name: 'p1' },
        { extendTools: () => [toolB], name: 'p2' },
      ],
      responseOptions: {},
    })

    expect(result.tools).toHaveLength(1)
    expect(result.tools?.[0].function.name).toBe('tool-a')
  })

  it('chains onFinish hooks in all mode', async () => {
    const calls: string[] = []
    const result = await resolveResponseHooks({
      ...baseHookOptions(),
      episodic: createEpisodic(),
      input: [],
      plugins: [
        { name: 'p1', onFinish: async () => { calls.push('p1') } },
        { name: 'p2', onFinish: async () => { calls.push('p2') } },
      ],
      responseOptions: {},
    })

    expect(result.onFinish).toBeDefined()
    await result.onFinish?.({} as never)
    expect(calls).toEqual(['p1', 'p2'])
  })

  it('chains onFinish with base responseOptions hook', async () => {
    const calls: string[] = []
    const result = await resolveResponseHooks({
      ...baseHookOptions(),
      episodic: createEpisodic(),
      input: [],
      plugins: [{ name: 'p1', onFinish: async () => { calls.push('plugin') } }],
      responseOptions: { onFinish: async () => { calls.push('base') } },
    })

    await result.onFinish?.({} as never)
    expect(calls).toEqual(['base', 'plugin'])
  })

  it('returns first non-null postToolCall in first mode', async () => {
    const result = await resolveResponseHooks({
      ...baseHookOptions(),
      episodic: createEpisodic(),
      input: [],
      plugins: [
        { name: 'p1', postToolCall: async () => undefined },
        { name: 'p2', postToolCall: async () => ({ result: 'p2' }) },
        { name: 'p3', postToolCall: async () => ({ result: 'p3' }) },
      ],
      responseOptions: {},
    })

    const hookResult = await result.postToolCall?.({} as never)
    expect(hookResult).toEqual({ result: 'p2' })
  })

  it('falls back to base preToolCall when all plugins return null', async () => {
    const result = await resolveResponseHooks({
      ...baseHookOptions(),
      episodic: createEpisodic(),
      input: [],
      plugins: [
        { name: 'p1', preToolCall: async () => undefined },
      ],
      responseOptions: { preToolCall: async () => ({ result: 'base' }) },
    })

    const hookResult = await result.preToolCall?.({} as never)
    expect(hookResult).toEqual({ result: 'base' })
  })

  it('merges prepareStep results across plugins and base', async () => {
    const result = await resolveResponseHooks({
      ...baseHookOptions(),
      episodic: createEpisodic(),
      input: [],
      plugins: [
        { name: 'p1', prepareStep: async () => ({ model: 'gpt-4' }) },
        { name: 'p2', prepareStep: async () => ({ temperature: 0.5 }) },
      ],
      responseOptions: { prepareStep: async () => ({ maxTokens: 100 }) },
    })

    const hookResult = await result.prepareStep?.({} as never)
    expect(hookResult).toEqual({ maxTokens: 100, model: 'gpt-4', temperature: 0.5 })
  })

  it('passes episodic and input to extendInput hooks', async () => {
    const episodic = createEpisodic()
    episodic.appendItems([message('history')], { source: 'user' })

    const calls: unknown[] = []
    await resolveResponseHooks({
      ...baseHookOptions(),
      episodic,
      input: [message('current')],
      plugins: [{
        extendInput: (opts) => {
          calls.push({
            episodicLength: opts.episodic.read().length,
            inputLength: opts.input.length,
          })
          return undefined
        },
        name: 'p1',
      }],
      responseOptions: {},
    })

    expect(calls).toEqual([{ episodicLength: 1, inputLength: 1 }])
  })
})
