import type { Agent, AgentChannel, AgentEventListener } from '@apeira/core'
import type { ExecutionBackend, RunningProcess } from '@apeira/plugin-sandbox'
import type { CompletionToolCall, ToolExecuteOptions } from '@xsai/shared-chat'

import type { HITLEvent, HITLRequest, HITLRequestEvent, HITLReviewContext } from '../src/index'

import { user } from '@apeira/core'
import { createSandbox, readOnlyProfile } from '@apeira/plugin-sandbox'
import { describe, expect, it, vi } from 'vitest'

import { hitl, toolPolicy } from '../src/index'

interface MockAgent extends Agent {
  aborted: unknown[]
  emitted: Array<{ channel: string, event: unknown }>
}

const createMockAgent = (): MockAgent => {
  const aborted: unknown[] = []
  const emitted: Array<{ channel: string, event: unknown }> = []
  const listeners = new Map<string, Set<AgentEventListener>>()

  return {
    abort: reason => aborted.push(reason),
    aborted,
    clear: async () => {},
    emit: async (channel: string, event: unknown) => {
      emitted.push({ channel, event })
      await Promise.all(Array.from(listeners.get(channel) ?? []).map(async listener => listener(event)))
    },
    emitted,
    getActiveTurnId: () => undefined,
    init: async () => {},
    initialInput: [],
    initialState: {},
    instructions: '',
    interrupt: async () => undefined,
    isIdle: () => true,
    plugins: [],
    reset: async () => {},
    runner: async () => ({ output: [] }),
    send: () => 'turn-mock',
    state: { get: () => ({}), restore: () => {}, set: () => {}, update: () => {} },
    stop: async () => {},
    storage: { append: () => {}, clear: () => {}, read: () => [] },
    subscribe: ((channel: string, listener: AgentEventListener) => {
      if (!listeners.has(channel))
        listeners.set(channel, new Set())
      listeners.get(channel)!.add(listener)
      return () => listeners.get(channel)?.delete(listener)
    }) as AgentChannel['subscribe'],
    tools: [],
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

const completedProcess = (): RunningProcess => ({
  completed: Promise.resolve({ exitCode: 0 }),
  end: async () => {},
  kill: () => {},
  write: async () => {},
})

const backend: ExecutionBackend = {
  check: async () => ({ errors: [], platform: process.platform, supported: true, warnings: [] }),
  name: 'mock',
  start: async () => completedProcess(),
}

const requestEvent = (agent: MockAgent): HITLRequestEvent | undefined =>
  agent.emitted
    .filter(entry => entry.channel === 'hitl')
    .map(entry => entry.event as HITLEvent)
    .findLast(event => event.type === 'request')

const startTurn = async (plugin: ReturnType<typeof hitl>, agent: MockAgent) => {
  await plugin.init?.(agent)
  await agent.emit('apeira', { turnId: 'turn-1', type: 'turn.start' })
}

const waitForRequest = async (agent: MockAgent) => {
  await vi.waitFor(() => expect(requestEvent(agent)).toBeDefined())
  return requestEvent(agent)!.request
}

describe('toolPolicy', () => {
  const toolRequest = (toolName: string): HITLRequest => ({
    createdAt: 1,
    options: ['approve', 'reject'],
    requestId: 'request-1',
    toolCall: createToolCall({ toolName }),
    turnId: 'turn-1',
    type: 'tool',
  })

  it('allows, denies, or abstains by tool name', () => {
    const policy = toolPolicy({
      allow: ['read', /^search_/],
      deny: ['delete'],
      denyReason: 'Destructive tool',
    })

    expect(policy(toolRequest('read'))).toEqual({ type: 'allow' })
    expect(policy(toolRequest('search_web'))).toEqual({ type: 'allow' })
    expect(policy(toolRequest('delete'))).toEqual({ reason: 'Destructive tool', type: 'deny' })
    expect(policy(toolRequest('write'))).toBeUndefined()
  })
})

describe('hitl', () => {
  it('routes ask through a configured reviewer with the live turn input', async () => {
    const review = vi.fn((_request: Readonly<HITLRequest>, _context: HITLReviewContext) => ({
      rationale: 'Narrow, authorized write.',
      riskLevel: 'low' as const,
      type: 'approve' as const,
      userAuthorization: 'high' as const,
    }))
    const plugin = hitl({ reviewer: { name: 'test-reviewer', review } })
    const agent = createMockAgent()
    await startTurn(plugin, agent)
    await plugin.prepareStep?.({ input: [user('Update the file.')], model: 'test', stepNumber: 0, steps: [] })

    const toolCall = createToolCall()
    await expect(plugin.preToolCall?.(toolCall, createExecuteOptions())).resolves.toEqual(toolCall)

    expect(review).toHaveBeenCalledOnce()
    expect(review.mock.calls[0][1].input).toEqual([user('Update the file.')])
    expect(requestEvent(agent)).toBeUndefined()
    expect(agent.emitted.findLast(entry => (entry.event as HITLEvent).type === 'resolved')?.event).toMatchObject({
      assessment: { type: 'approve' },
      source: 'reviewer',
    })
  })

  it('asks the user when automatic review fails by default', async () => {
    const plugin = hitl({
      reviewer: {
        name: 'test-reviewer',
        review: () => ({ failure: { type: 'timeout' }, type: 'failure' }),
      },
    })
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    const pending = plugin.preToolCall?.(createToolCall(), createExecuteOptions())
    const request = await waitForRequest(agent)
    expect(agent.emitted.some(entry => (entry.event as HITLEvent).type === 'review_failed')).toBe(true)
    plugin.resolve(request.requestId, { type: 'approve' })

    await expect(pending).resolves.toMatchObject({ toolName: 'write' })
  })

  it('does not call the reviewer for policy allow or deny', async () => {
    const review = vi.fn(() => ({
      rationale: 'Should not run.',
      riskLevel: 'low' as const,
      type: 'approve' as const,
      userAuthorization: 'high' as const,
    }))
    const reviewer = { name: 'test-reviewer', review }
    const allowed = hitl({ policies: [() => ({ type: 'allow' })], reviewer })
    const allowedAgent = createMockAgent()
    await startTurn(allowed, allowedAgent)
    await expect(allowed.preToolCall?.(createToolCall(), createExecuteOptions())).resolves.toMatchObject({
      toolName: 'write',
    })

    const denied = hitl({ policies: [() => ({ type: 'deny' })], reviewer })
    const deniedAgent = createMockAgent()
    await startTurn(denied, deniedAgent)
    await expect(denied.preToolCall?.(createToolCall(), createExecuteOptions())).resolves.toMatchObject({
      result: 'Tool execution was not approved.',
    })
    expect(review).not.toHaveBeenCalled()
  })

  it('denies an explicit automatic review rejection by default', async () => {
    const plugin = hitl({
      reviewer: {
        name: 'test-reviewer',
        review: () => ({
          rationale: 'The operation is too risky.',
          riskLevel: 'critical',
          type: 'deny',
          userAuthorization: 'low',
        }),
      },
    })
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    await expect(plugin.preToolCall?.(createToolCall(), createExecuteOptions())).resolves.toMatchObject({
      result: 'Tool execution was not approved. Reason: The operation is too risky.',
    })
    expect(requestEvent(agent)).toBeUndefined()
  })

  it('cancels an active reviewer without falling back to the user', async () => {
    const controller = new AbortController()
    const plugin = hitl({
      reviewer: {
        name: 'test-reviewer',
        review: async (_request, context) => new Promise((_, reject) => {
          context.signal?.addEventListener('abort', () => reject(context.signal?.reason), { once: true })
        }),
      },
    })
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    const pending = plugin.preToolCall?.(createToolCall(), createExecuteOptions(controller.signal))
    await vi.waitFor(() => expect(agent.emitted.some(
      entry => (entry.event as HITLEvent).type === 'reviewing',
    )).toBe(true))
    controller.abort('stop')

    await expect(pending).rejects.toBe('stop')
    expect(requestEvent(agent)).toBeUndefined()
    expect(agent.emitted.findLast(entry => (entry.event as HITLEvent).type === 'cancelled')?.event).toMatchObject({
      reason: 'aborted',
    })
  })

  it('auto-review approvals are once-only and reviewer switching affects future requests', async () => {
    const reviewer = {
      name: 'test-reviewer',
      review: vi.fn(() => ({
        rationale: 'Allowed.',
        riskLevel: 'low' as const,
        type: 'approve' as const,
        userAuthorization: 'high' as const,
      })),
    }
    const plugin = hitl({ reviewer })
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    await plugin.preToolCall?.(createToolCall(), createExecuteOptions())
    await plugin.preToolCall?.(createToolCall({ toolCallId: 'call-2' }), createExecuteOptions())
    expect(reviewer.review).toHaveBeenCalledTimes(2)

    plugin.setReviewer('user')
    expect(plugin.reviewer).toBe('user')
    const pending = plugin.preToolCall?.(createToolCall({ toolCallId: 'call-3' }), createExecuteOptions())
    const request = await waitForRequest(agent)
    plugin.resolve(request.requestId, { type: 'approve' })
    await pending
    expect(reviewer.review).toHaveBeenCalledTimes(2)
  })

  it('approves and lists a pending tool request', async () => {
    const plugin = hitl()
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    const toolCall = createToolCall()
    const pending = plugin.preToolCall?.(toolCall, createExecuteOptions())
    const request = await waitForRequest(agent)

    expect(plugin.listPending()).toEqual([request])
    expect(plugin.resolve(request.requestId, { type: 'approve' })).toBe(true)
    await expect(pending).resolves.toEqual(toolCall)
    expect(plugin.listPending()).toEqual([])
    expect(agent.emitted.findLast(entry => (entry.event as HITLEvent).type === 'resolved')?.event).toMatchObject({
      decision: { type: 'approve' },
      request,
      source: 'user',
      type: 'resolved',
    })
  })

  it('rejects a tool and can abort its turn explicitly', async () => {
    const plugin = hitl()
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    const pending = plugin.preToolCall?.(createToolCall(), createExecuteOptions())
    const request = await waitForRequest(agent)
    plugin.resolve(request.requestId, {
      abortTurn: true,
      message: 'User rejected',
      type: 'reject',
    })

    await expect(pending).resolves.toMatchObject({
      result: 'Tool execution was not approved. Reason: User rejected',
    })
    expect(agent.aborted).toEqual(['User rejected'])
  })

  it('edits tool arguments before execution', async () => {
    const plugin = hitl()
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    const pending = plugin.preToolCall?.(createToolCall(), createExecuteOptions())
    const request = await waitForRequest(agent)
    plugin.resolve(request.requestId, { args: '{"path":"./safe.txt"}', type: 'edit' })

    await expect(pending).resolves.toMatchObject({ args: '{"path":"./safe.txt"}' })
  })

  it('automatically applies policies with deny precedence', async () => {
    const plugin = hitl({
      policies: [
        () => ({ type: 'allow' }),
        () => ({ type: 'ask' }),
        () => ({ reason: 'Denied by policy', type: 'deny' }),
      ],
    })
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    await expect(plugin.preToolCall?.(createToolCall(), createExecuteOptions())).resolves.toMatchObject({
      result: 'Tool execution was not approved. Reason: Denied by policy',
    })
    expect(requestEvent(agent)).toBeUndefined()
  })

  it('asks when every policy abstains', async () => {
    const plugin = hitl({ policies: [toolPolicy({ allow: ['read'] })] })
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    const pending = plugin.preToolCall?.(createToolCall(), createExecuteOptions())
    const request = await waitForRequest(agent)
    plugin.resolve(request.requestId, { type: 'approve' })

    await expect(pending).resolves.toMatchObject({ toolName: 'write' })
  })

  it('caches explicit session approvals', async () => {
    const plugin = hitl()
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    const first = plugin.preToolCall?.(createToolCall(), createExecuteOptions())
    const request = await waitForRequest(agent)
    plugin.resolve(request.requestId, { scope: 'session', type: 'approve' })
    await first

    const second = createToolCall({ toolCallId: 'call-2' })
    await expect(plugin.preToolCall?.(second, createExecuteOptions())).resolves.toEqual(second)
    expect(plugin.listPending()).toEqual([])
    expect(agent.emitted.findLast(entry => (entry.event as HITLEvent).type === 'resolved')?.event).toMatchObject({
      decision: { scope: 'session', type: 'approve' },
      source: 'session',
    })
  })

  it('emits cancellation instead of a rejection decision on abort', async () => {
    const controller = new AbortController()
    const plugin = hitl()
    const agent = createMockAgent()
    await startTurn(plugin, agent)

    const pending = plugin.preToolCall?.(createToolCall(), createExecuteOptions(controller.signal))
    const request = await waitForRequest(agent)
    controller.abort('stop')

    await expect(pending).rejects.toBe('stop')
    expect(plugin.resolve(request.requestId, { type: 'approve' })).toBe(false)
    expect(agent.emitted.findLast(entry => (entry.event as HITLEvent).type === 'cancelled')?.event).toMatchObject({
      reason: 'aborted',
      request,
      type: 'cancelled',
    })
  })

  it('fails closed without an active turn', async () => {
    const plugin = hitl({ policies: [() => ({ type: 'allow' })] })
    const agent = createMockAgent()
    await plugin.init?.(agent)

    await expect(plugin.preToolCall?.(createToolCall(), createExecuteOptions())).resolves.toMatchObject({
      result: 'Tool execution was not approved. Reason: Tool execution blocked: missing or untracked execution context.',
    })
    expect(requestEvent(agent)).toBeUndefined()
  })

  it('uses the same request lifecycle for sandbox permissions', async () => {
    const plugin = hitl()
    const agent = createMockAgent()
    const sandbox = createSandbox({
      adapter: backend,
      authorizeEscalation: plugin.authorizeEscalation,
      profile: readOnlyProfile(),
    })
    await startTurn(plugin, agent)

    const pending = sandbox.execute({
      command: 'true',
      escalation: { justification: 'read fixtures', permissions: {}, type: 'expand' },
      requestId: 'execution-1',
    })
    const request = await waitForRequest(agent)

    expect(request).toMatchObject({ executionRequestId: 'execution-1', type: 'permission' })
    expect(request.options).not.toContain('edit')
    plugin.resolve(request.requestId, { type: 'approve' })
    await expect(pending).resolves.toMatchObject({ requestId: 'execution-1' })
    await sandbox.dispose()
  })

  it('cancels pending permissions when the turn ends', async () => {
    const plugin = hitl()
    const agent = createMockAgent()
    const sandbox = createSandbox({
      adapter: backend,
      authorizeEscalation: plugin.authorizeEscalation,
      profile: readOnlyProfile(),
    })
    await startTurn(plugin, agent)

    const pending = sandbox.execute({
      command: 'true',
      escalation: { justification: 'read fixtures', permissions: {}, type: 'expand' },
    })
    await waitForRequest(agent)
    await agent.emit('apeira', { turnId: 'turn-1', type: 'turn.aborted' })

    await expect(pending).rejects.toThrow('Approval cancelled.')
    expect(agent.emitted.findLast(entry => (entry.event as HITLEvent).type === 'cancelled')?.event).toMatchObject({
      reason: 'turn_finished',
    })
    await sandbox.dispose()
  })

  it('cancels a permission request through the sandbox abort signal', async () => {
    const controller = new AbortController()
    const plugin = hitl()
    const agent = createMockAgent()
    const sandbox = createSandbox({
      adapter: backend,
      authorizeEscalation: plugin.authorizeEscalation,
      profile: readOnlyProfile(),
    })
    await startTurn(plugin, agent)

    const pending = sandbox.execute({
      command: 'true',
      escalation: { justification: 'read fixtures', permissions: {}, type: 'expand' },
    }, { signal: controller.signal })
    await waitForRequest(agent)
    controller.abort('stop')

    await expect(pending).rejects.toBe('stop')
    expect(agent.emitted.findLast(entry => (entry.event as HITLEvent).type === 'cancelled')?.event).toMatchObject({
      reason: 'aborted',
    })
    await sandbox.dispose()
  })
})
