import type { Agent, AgentChannel, AgentEventListener } from '@apeira/core'
import type { CompletionToolCall, ToolExecuteOptions } from '@xsai/shared-chat'

import { describe, expect, it } from 'vitest'

import { approveToolCall, autoReviewByPattern, humanInTheLoop, rejectToolCall } from '../src/index'

interface MockAgent extends Agent {
  emitted: Array<{ channel: string, event: unknown }>
}

const createMockAgent = (): MockAgent => {
  const emitted: Array<{ channel: string, event: unknown }> = []
  const listeners = new Map<string, Set<AgentEventListener>>()

  return {
    abort: () => {},
    clear: async () => {},
    emit: async (channel: string, event: unknown) => {
      emitted.push({ channel, event })
      await Promise.all(Array.from(listeners.get(channel) ?? []).map(async l => l(event)))
    },
    emitted,
    getActiveTurnId: () => undefined,
    init: async () => {},
    instructions: '',
    interrupt: async () => undefined,
    isIdle: () => true,
    plugins: [],
    reset: async () => {},
    runner: async () => ({ output: [] }),
    send: () => 'turn-mock',
    state: { get: () => ({}), set: () => {}, update: () => {} },
    stop: async () => {},
    storage: { append: () => {}, clear: () => {}, read: () => [], reset: () => {} },
    subscribe: ((channel: string, listener: AgentEventListener) => {
      if (!listeners.has(channel))
        listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
      return () => {
        listeners.get(channel)?.delete(listener)
      }
    }) as AgentChannel['subscribe'],
    wait: async () => {},
  }
}

const createToolCall = (overrides: Partial<CompletionToolCall> = {}): CompletionToolCall => ({
  args: '{"path":"./file.txt"}',
  toolCallId: 'call-1',
  toolCallType: 'function',
  toolName: 'write',
  ...overrides,
})

const createExecuteOptions = (signal?: AbortSignal): ToolExecuteOptions => ({
  abortSignal: signal,
  messages: [],
  toolCallId: 'call-1',
})

describe('autoReviewByPattern', () => {
  it('auto-approves matching never patterns and leaves others pending', () => {
    const review = autoReviewByPattern({
      always: ['bash'],
      never: ['read'],
    })

    expect(review(createToolCall({ toolName: 'read' }), {})).toEqual({ type: 'approve' })
    expect(review(createToolCall({ toolName: 'bash' }), {})).toEqual({ type: 'pending' })
    expect(review(createToolCall({ toolName: 'edit' }), {})).toEqual({ type: 'pending' })
  })

  it('supports regular expression patterns', () => {
    const review = autoReviewByPattern({
      always: [/^write_/, /_delete$/],
      never: [/^read_/, /_list$/],
    })

    expect(review(createToolCall({ toolName: 'read_file' }), {})).toEqual({ type: 'approve' })
    expect(review(createToolCall({ toolName: 'user_list' }), {})).toEqual({ type: 'approve' })
    expect(review(createToolCall({ toolName: 'write_file' }), {})).toEqual({ type: 'pending' })
    expect(review(createToolCall({ toolName: 'hard_delete' }), {})).toEqual({ type: 'pending' })
  })

  it('supports exact strings alongside regular expressions', () => {
    const review = autoReviewByPattern({
      always: [/^write_/],
      never: ['read'],
    })

    expect(review(createToolCall({ toolName: 'read' }), {})).toEqual({ type: 'approve' })
    expect(review(createToolCall({ toolName: 'write_file' }), {})).toEqual({ type: 'pending' })
    expect(review(createToolCall({ toolName: 'anything' }), {})).toEqual({ type: 'pending' })
  })
})

describe('humanInTheLoop', () => {
  it('auto-approves when per-tool policy disables approval', async () => {
    const plugin = humanInTheLoop({
      toolPolicies: {
        read: { needsApproval: false },
      },
    })
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    const toolCall = createToolCall({ toolName: 'read' })
    const result = await plugin.preToolCall?.(toolCall, createExecuteOptions(new AbortController().signal))

    expect(result).toEqual(toolCall)
    expect(mockAgent.emitted.filter(entry => entry.channel === 'hitl').map(entry => (entry.event as { type: string }).type)).toEqual([
      'hitl.auto_reviewed',
      'hitl.resolved',
    ])
  })

  it('auto-rejects through autoReview and returns a tool result', async () => {
    const plugin = humanInTheLoop({
      autoReview: () => ({ reason: 'Policy blocked', type: 'reject' }),
    })
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    const result = await plugin.preToolCall?.(createToolCall(), createExecuteOptions(new AbortController().signal))

    expect(result).toMatchObject({
      result: 'Tool execution was not approved. Reason: Policy blocked',
      toolCallId: 'call-1',
      toolName: 'write',
    })
    expect(mockAgent.emitted.filter(entry => entry.channel === 'hitl').map(entry => (entry.event as { type: string }).type)).toEqual([
      'hitl.auto_reviewed',
      'hitl.resolved',
    ])
  })

  it('fails secure when execution context is missing for a gated tool', async () => {
    const plugin = humanInTheLoop()
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)

    const result = await plugin.preToolCall?.(createToolCall(), createExecuteOptions())

    expect(result).toMatchObject({
      result: 'Tool execution was not approved. Reason: Tool execution blocked: missing or untracked execution context.',
      toolCallId: 'call-1',
      toolName: 'write',
    })
    expect(mockAgent.emitted).toEqual([])
  })

  it('emits a request and resumes execution when approved', async () => {
    const plugin = humanInTheLoop()
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    const toolCall = createToolCall()
    const pending = plugin.preToolCall?.(toolCall, createExecuteOptions(new AbortController().signal))

    expect(mockAgent.emitted.filter(entry => entry.channel === 'hitl').map(entry => (entry.event as { type: string }).type)).toEqual(['hitl.request'])
    await mockAgent.emit('hitl', { toolCallId: toolCall.toolCallId, type: 'control.approve' })
    await expect(pending).resolves.toEqual(toolCall)

    const resolved = mockAgent.emitted.findLast(entry => (entry.event as { type: string }).type === 'hitl.resolved')
    expect(resolved?.event).toMatchObject({
      auto: false,
      decision: 'approve',
      type: 'hitl.resolved',
    })
  })

  it('returns a rejection result when rejected by a human', async () => {
    const plugin = humanInTheLoop({
      rejectionMessage: 'Denied.',
    })
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    const pending = plugin.preToolCall?.(createToolCall(), createExecuteOptions(new AbortController().signal))
    await mockAgent.emit('hitl', { reason: 'No write access', toolCallId: 'call-1', type: 'control.reject' })

    await expect(pending).resolves.toMatchObject({
      result: 'Denied.',
      toolCallId: 'call-1',
      toolName: 'write',
    })
    expect(mockAgent.emitted.findLast(entry => (entry.event as { type: string }).type === 'hitl.resolved')?.event).toMatchObject({
      auto: false,
      decision: 'reject',
      reason: 'No write access',
      type: 'hitl.resolved',
    })
  })

  it('ignores duplicate approvals after the first resolution', async () => {
    const plugin = humanInTheLoop()
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    const toolCall = createToolCall()
    const pending = plugin.preToolCall?.(toolCall, createExecuteOptions(new AbortController().signal))

    await mockAgent.emit('hitl', { toolCallId: toolCall.toolCallId, type: 'control.approve' })
    await mockAgent.emit('hitl', { toolCallId: toolCall.toolCallId, type: 'control.approve' })
    await expect(pending).resolves.toEqual(toolCall)
    expect(mockAgent.emitted.filter(entry => (entry.event as { type: string }).type === 'hitl.resolved')).toHaveLength(1)
  })

  it('rejects pending work on abort and cleans up resolver state', async () => {
    const controller = new AbortController()
    const plugin = humanInTheLoop()
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    const pending = plugin.preToolCall?.(createToolCall({ toolCallId: 'call-2' }), createExecuteOptions(controller.signal))
    controller.abort('stop')

    await expect(pending).rejects.toBe('stop')
    const resolvedCount = mockAgent.emitted.filter(entry => (entry.event as { type: string }).type === 'hitl.resolved').length
    await mockAgent.emit('hitl', { toolCallId: 'call-2', type: 'control.approve' })
    await mockAgent.emit('hitl', { toolCallId: 'call-2', type: 'control.reject' })
    expect(mockAgent.emitted.filter(entry => (entry.event as { type: string }).type === 'hitl.resolved').length).toBe(resolvedCount)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    const plugin = humanInTheLoop()
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    controller.abort('already-aborted')

    await expect(
      plugin.preToolCall?.(createToolCall({ toolCallId: 'call-2' }), createExecuteOptions(controller.signal)),
    ).rejects.toBe('already-aborted')
    const resolvedCount = mockAgent.emitted.filter(entry => (entry.event as { type: string }).type === 'hitl.resolved').length
    await mockAgent.emit('hitl', { toolCallId: 'call-2', type: 'control.approve' })
    expect(mockAgent.emitted.filter(entry => (entry.event as { type: string }).type === 'hitl.resolved').length).toBe(resolvedCount)
  })

  it('approves via sugar function', async () => {
    const plugin = humanInTheLoop()
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    const toolCall = createToolCall({ toolCallId: 'call-sugar' })
    const pending = plugin.preToolCall?.(toolCall, createExecuteOptions(new AbortController().signal))

    expect(mockAgent.emitted.filter(entry => entry.channel === 'hitl').map(entry => (entry.event as { type: string }).type)).toEqual(['hitl.request'])

    await approveToolCall(mockAgent, { toolCallId: 'call-sugar' })
    await expect(pending).resolves.toEqual(toolCall)
  })

  it('rejects via sugar function', async () => {
    const plugin = humanInTheLoop({ rejectionMessage: 'Sugar denied.' })
    const mockAgent = createMockAgent()

    await plugin.init?.(mockAgent)
    await mockAgent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })

    const toolCall = createToolCall({ toolCallId: 'call-sugar-reject' })
    const pending = plugin.preToolCall?.(toolCall, createExecuteOptions(new AbortController().signal))

    await rejectToolCall(mockAgent, { reason: 'Too sweet', toolCallId: 'call-sugar-reject' })
    await expect(pending).resolves.toMatchObject({
      result: 'Sugar denied.',
      toolCallId: 'call-sugar-reject',
      toolName: 'write',
    })
  })
})
