import type { AgentPluginApi } from '@apeira/core'
import type { CompletionToolCall, ToolExecuteOptions } from '@xsai/shared-chat'

import { afterEach, describe, expect, it } from 'vitest'

import { approveToolCall, autoReviewByPattern, humanInTheLoop, rejectToolCall } from '../src/index'

const createPluginApi = () => {
  const emitted: Array<{ channel: string, event: unknown }> = []

  const api: AgentPluginApi = {
    emit: (channel, event) => {
      emitted.push({ channel, event })
    },
    subscribe: () => () => true,
  }

  return { api, emitted }
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

afterEach(() => {
  approveToolCall('call-1')
  approveToolCall('call-2')
  rejectToolCall('call-1')
  rejectToolCall('call-2')
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

  it('supports wildcard patterns', () => {
    const review = autoReviewByPattern({
      always: ['write_*', '*_delete'],
      never: ['read_*', '*_list'],
    })

    expect(review(createToolCall({ toolName: 'read_file' }), {})).toEqual({ type: 'approve' })
    expect(review(createToolCall({ toolName: 'user_list' }), {})).toEqual({ type: 'approve' })
    expect(review(createToolCall({ toolName: 'write_file' }), {})).toEqual({ type: 'pending' })
    expect(review(createToolCall({ toolName: 'hard_delete' }), {})).toEqual({ type: 'pending' })
  })

  it('supports the catch-all wildcard pattern', () => {
    const review = autoReviewByPattern({
      never: ['*'],
    })

    expect(review(createToolCall({ toolName: 'anything' }), {})).toEqual({ type: 'approve' })
  })
})

describe('humanInTheLoop', () => {
  it('auto-approves when per-tool policy disables approval', async () => {
    const plugin = humanInTheLoop({
      toolPolicies: {
        read: { needsApproval: false },
      },
    })
    const { api, emitted } = createPluginApi()
    const signal = new AbortController().signal

    await plugin.setup?.(api)
    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      sessionId: 'session-1',
      signal,
      turnId: 'turn-1',
      turnInput: { content: 'hi', role: 'user', type: 'message' },
    })

    const toolCall = createToolCall({ toolName: 'read' })
    const result = await plugin.preToolCall?.(toolCall, createExecuteOptions(signal))

    expect(result).toEqual(toolCall)
    expect(emitted.map(entry => (entry.event as { type: string }).type)).toEqual([
      'hitl.auto_reviewed',
      'hitl.resolved',
    ])
  })

  it('auto-rejects through autoReview and returns a tool result', async () => {
    const plugin = humanInTheLoop({
      autoReview: () => ({ reason: 'Policy blocked', type: 'reject' }),
    })
    const { api, emitted } = createPluginApi()
    const signal = new AbortController().signal

    await plugin.setup?.(api)
    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      sessionId: 'session-1',
      signal,
      turnId: 'turn-1',
      turnInput: { content: 'hi', role: 'user', type: 'message' },
    })

    const result = await plugin.preToolCall?.(createToolCall(), createExecuteOptions(signal))

    expect(result).toMatchObject({
      result: 'Tool execution was not approved. Reason: Policy blocked',
      toolCallId: 'call-1',
      toolName: 'write',
    })
    expect(emitted.map(entry => (entry.event as { type: string }).type)).toEqual([
      'hitl.auto_reviewed',
      'hitl.resolved',
    ])
  })

  it('fails secure when execution context is missing for a gated tool', async () => {
    const plugin = humanInTheLoop()
    const { api, emitted } = createPluginApi()

    await plugin.setup?.(api)

    const result = await plugin.preToolCall?.(createToolCall(), createExecuteOptions())

    expect(result).toMatchObject({
      result: 'Tool execution was not approved. Reason: Tool execution blocked: missing or untracked execution context.',
      toolCallId: 'call-1',
      toolName: 'write',
    })
    expect(emitted).toEqual([])
  })

  it('emits a request and resumes execution when approved', async () => {
    const plugin = humanInTheLoop()
    const { api, emitted } = createPluginApi()
    const signal = new AbortController().signal

    await plugin.setup?.(api)
    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      sessionId: 'session-1',
      signal,
      turnId: 'turn-1',
      turnInput: { content: 'hi', role: 'user', type: 'message' },
    })

    const toolCall = createToolCall()
    const pending = plugin.preToolCall?.(toolCall, createExecuteOptions(signal))

    expect(emitted.map(entry => (entry.event as { type: string }).type)).toEqual(['hitl.request'])
    expect(approveToolCall(toolCall.toolCallId)).toBe(true)
    await expect(pending).resolves.toEqual(toolCall)

    const resolved = emitted.findLast(entry => (entry.event as { type: string }).type === 'hitl.resolved')
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
    const { api, emitted } = createPluginApi()
    const signal = new AbortController().signal

    await plugin.setup?.(api)
    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      sessionId: 'session-1',
      signal,
      turnId: 'turn-1',
      turnInput: { content: 'hi', role: 'user', type: 'message' },
    })

    const pending = plugin.preToolCall?.(createToolCall(), createExecuteOptions(signal))
    expect(rejectToolCall('call-1', 'No write access')).toBe(true)

    await expect(pending).resolves.toMatchObject({
      result: 'Denied.',
      toolCallId: 'call-1',
      toolName: 'write',
    })
    expect(emitted.findLast(entry => (entry.event as { type: string }).type === 'hitl.resolved')?.event).toMatchObject({
      auto: false,
      decision: 'reject',
      reason: 'No write access',
      type: 'hitl.resolved',
    })
  })

  it('ignores duplicate approvals after the first resolution', async () => {
    const plugin = humanInTheLoop()
    const { api, emitted } = createPluginApi()
    const signal = new AbortController().signal

    await plugin.setup?.(api)
    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      sessionId: 'session-1',
      signal,
      turnId: 'turn-1',
      turnInput: { content: 'hi', role: 'user', type: 'message' },
    })

    const toolCall = createToolCall()
    const pending = plugin.preToolCall?.(toolCall, createExecuteOptions(signal))

    expect(approveToolCall(toolCall.toolCallId)).toBe(true)
    expect(approveToolCall(toolCall.toolCallId)).toBe(false)
    await expect(pending).resolves.toEqual(toolCall)
    expect(emitted.filter(entry => (entry.event as { type: string }).type === 'hitl.resolved')).toHaveLength(1)
  })

  it('rejects pending work on abort and cleans up resolver state', async () => {
    const controller = new AbortController()
    const plugin = humanInTheLoop()
    const { api } = createPluginApi()

    await plugin.setup?.(api)
    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      sessionId: 'session-1',
      signal: controller.signal,
      turnId: 'turn-1',
      turnInput: { content: 'hi', role: 'user', type: 'message' },
    })

    const pending = plugin.preToolCall?.(createToolCall({ toolCallId: 'call-2' }), createExecuteOptions(controller.signal))
    controller.abort('stop')

    await expect(pending).rejects.toBe('stop')
    expect(approveToolCall('call-2')).toBe(false)
    expect(rejectToolCall('call-2')).toBe(false)
  })

  it('rejects immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    const plugin = humanInTheLoop()
    const { api } = createPluginApi()

    await plugin.setup?.(api)
    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      sessionId: 'session-1',
      signal: controller.signal,
      turnId: 'turn-1',
      turnInput: { content: 'hi', role: 'user', type: 'message' },
    })

    controller.abort('already-aborted')

    await expect(
      plugin.preToolCall?.(createToolCall({ toolCallId: 'call-2' }), createExecuteOptions(controller.signal)),
    ).rejects.toBe('already-aborted')
    expect(approveToolCall('call-2')).toBe(false)
  })
})
