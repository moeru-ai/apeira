import type { PluginPrivateStateApi } from '@apeira/core'
import type { CompletionToolCall, Tool } from '@xsai/shared-chat'

import { describe, expect, it } from 'vitest'

import { hitl, withHitlMetadata } from '../src'

const createPrivateState = <T>(): PluginPrivateStateApi<T> => {
  let value: T | undefined

  return {
    clear: () => {
      value = undefined
    },
    get: () => value,
    set: (next) => {
      value = next
    },
    update: (fn) => {
      value = fn(value)
      return value
    },
  }
}

const toolCall: CompletionToolCall = {
  args: '{"command":"git status"}',
  toolCallId: 'call_1',
  toolCallType: 'function',
  toolName: 'bash',
}

const createTool = (): Tool => ({
  execute: () => 'ok',
  function: {
    name: 'bash',
    parameters: {},
  },
  type: 'function',
})

const createHookOptions = (options: {
  privateState?: PluginPrivateStateApi
  tools?: Tool[]
} = {}) => ({
  messages: [],
  privateState: options.privateState ?? createPrivateState(),
  sessionId: 'session',
  tools: options.tools ?? [],
  toolCallId: toolCall.toolCallId,
  turnId: 'turn',
})

const callPre = (
  controller: ReturnType<typeof hitl>,
  hookOptions: ReturnType<typeof createHookOptions>,
  nextToolCall = toolCall,
) => {
  const promise = controller.plugin.preToolCall?.(nextToolCall, {
    ...hookOptions,
    toolCallId: nextToolCall.toolCallId,
  })

  return {
    flush: async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      return controller.pending()
    },
    promise,
  }
}

describe('@apeira/plugin-hitl', () => {
  it('allows tools when mode is allow', async () => {
    const controller = hitl({ mode: 'allow' })
    const hookOptions = createHookOptions()

    await expect(controller.plugin.preToolCall?.(toolCall, hookOptions)).resolves.toBeUndefined()
  })

  it('returns a synthetic tool result when mode is deny', async () => {
    const controller = hitl({ mode: 'deny' })
    const hookOptions = createHookOptions()

    await expect(controller.plugin.preToolCall?.(toolCall, hookOptions)).resolves.toMatchObject({
      result: 'TOOL_HITL_REJECTED',
      toolCallId: 'call_1',
      toolName: 'bash',
    })
  })

  it('asks with metadata and remembers conversation approvals by exact tool key', async () => {
    const privateState = createPrivateState()
    const controller = hitl({ mode: 'ask' })
    const tool = withHitlMetadata(createTool(), {
      risk: 'medium',
      source: 'common-tools',
      targets: ['workspace'],
    })
    const hookOptions = createHookOptions({ privateState, tools: [tool] })

    const first = callPre(controller, hookOptions)
    await expect(first.flush()).resolves.toMatchObject([{
      id: 'hitl_call_1',
      metadata: {
        risk: 'medium',
        source: 'common-tools',
        targets: ['workspace'],
      },
    }])
    expect(controller.approve('hitl_call_1', 'conversation')).toBe(true)
    await expect(first.promise).resolves.toBeUndefined()

    await expect(controller.plugin.preToolCall?.(toolCall, hookOptions)).resolves.toBeUndefined()

    const dangerous = callPre(controller, hookOptions, {
      ...toolCall,
      args: '{"command":"rm -rf ."}',
      toolCallId: 'call_2',
    })

    await expect(dangerous.flush()).resolves.toMatchObject([{
      id: 'hitl_call_2',
    }])
    expect(controller.reject('hitl_call_2')).toBe(true)
    await expect(dangerous.promise).resolves.toMatchObject({
      result: 'TOOL_HITL_REJECTED',
    })
  })

  it('uses call approvals once and asks again on the next matching call', async () => {
    const controller = hitl({ mode: 'ask' })
    const hookOptions = createHookOptions()

    const first = callPre(controller, hookOptions)
    await first.flush()
    expect(controller.approve('hitl_call_1', 'call')).toBe(true)
    await expect(first.promise).resolves.toBeUndefined()

    const second = callPre(controller, hookOptions)
    await expect(second.flush()).resolves.toMatchObject([{ id: 'hitl_call_1' }])
    expect(controller.reject('hitl_call_1')).toBe(true)
    await expect(second.promise).resolves.toMatchObject({ result: 'TOOL_HITL_REJECTED' })
  })

  it('keeps run approvals only until the turn finishes', async () => {
    const controller = hitl({ mode: 'ask' })
    const hookOptions = createHookOptions()

    const first = callPre(controller, hookOptions)
    await first.flush()
    expect(controller.approve('hitl_call_1', 'run')).toBe(true)
    await expect(first.promise).resolves.toBeUndefined()

    await expect(controller.plugin.preToolCall?.(toolCall, hookOptions)).resolves.toBeUndefined()

    await controller.plugin.onTurnDone?.({
      agentName: 'agent',
      context: {},
      input: [],
      privateState: createPrivateState(),
      sessionId: 'session',
      signal: new AbortController().signal,
      snapshot: {
        context: {},
        episodic: '',
        version: 1,
      },
      turnId: 'turn',
      turnInput: { content: 'run', role: 'user', type: 'message' },
    })

    const second = callPre(controller, hookOptions)
    await expect(second.flush()).resolves.toMatchObject([{ id: 'hitl_call_1' }])
    expect(controller.reject('hitl_call_1')).toBe(true)
    await expect(second.promise).resolves.toMatchObject({ result: 'TOOL_HITL_REJECTED' })
  })

  it('lets deny mode override existing conversation approvals', async () => {
    const privateState = createPrivateState()
    const controller = hitl({ mode: 'ask' })
    const hookOptions = createHookOptions({ privateState })

    const first = callPre(controller, hookOptions)
    await first.flush()
    expect(controller.approve('hitl_call_1', 'conversation')).toBe(true)
    await first.promise

    controller.setMode('deny')

    await expect(controller.plugin.preToolCall?.(toolCall, hookOptions)).resolves.toMatchObject({
      result: 'TOOL_HITL_REJECTED',
    })
  })

  it('keeps rejected decision available and asks again after rejecting the current call', async () => {
    const controller = hitl({ mode: 'ask' })
    const hookOptions = createHookOptions()

    const first = callPre(controller, hookOptions)
    await first.flush()

    expect(controller.reject('hitl_call_1', 'TOOL_HITL_REJECTED: denied by reviewer')).toBe(true)
    expect(controller.getDecisionForResume('hitl_call_1')).toMatchObject({
      message: 'TOOL_HITL_REJECTED: denied by reviewer',
      type: 'rejected',
    })

    await expect(first.promise).resolves.toMatchObject({
      result: 'TOOL_HITL_REJECTED: denied by reviewer',
    })

    const second = callPre(controller, hookOptions)
    await expect(second.flush()).resolves.toMatchObject([{ id: 'hitl_call_1' }])
    expect(controller.reject('hitl_call_1')).toBe(true)
    await expect(second.promise).resolves.toMatchObject({
      result: 'TOOL_HITL_REJECTED',
    })
  })
})
