import type { AgentInput, Runner, Tool } from '@apeira/core'
import type { ToolExecuteOptions } from '@xsai/shared-chat'

import type { HITLRequest } from '../src/index'

import { assistant, user } from '@apeira/core'
import { describe, expect, it, vi } from 'vitest'

import { autoReview } from '../src/auto-review/index'

const request: HITLRequest = {
  createdAt: 1,
  options: ['approve', 'reject'],
  requestId: 'request-1',
  toolCall: {
    args: '{"path":"README.md"}',
    toolCallId: 'call-1',
    toolCallType: 'function',
    toolName: 'write',
  },
  turnId: 'turn-1',
  type: 'tool',
}

const toolOptions: ToolExecuteOptions = {
  messages: [],
  toolCallId: 'review-1',
}

const approvingRunner = (inspect?: (input: readonly AgentInput[]) => void): Runner => async (context) => {
  inspect?.(context.input)
  const submit = context.tools.find(tool => tool.function.name === 'submit_review')
  await submit?.execute({
    rationale: 'The requested local edit is narrow and authorized.',
    riskLevel: 'low',
    type: 'approve',
    userAuthorization: 'high',
  }, toolOptions)
  return { output: [assistant('Review submitted.')] }
}

describe('autoReview', () => {
  it('creates a temporary reviewer and returns its structured decision', async () => {
    let inspectedInput: readonly AgentInput[] | undefined
    const reviewer = autoReview()
    const runner = approvingRunner((input) => {
      inspectedInput = input
    })

    await expect(reviewer.review(request, {
      input: [user('Update README.md.')],
      runner,
    })).resolves.toEqual({
      rationale: 'The requested local edit is narrow and authorized.',
      riskLevel: 'low',
      type: 'approve',
      userAuthorization: 'high',
    })

    const prompt = inspectedInput?.[0]
    if (prompt == null)
      throw new Error('Reviewer input was not captured.')
    expect(prompt).toMatchObject({ role: 'user', type: 'message' })
    expect(JSON.stringify(prompt)).toContain('Update README.md.')
    expect((prompt as { content: string }).content).toContain('"tool": "write"')
    expect((prompt as { content: string }).content).toContain('"type": "apeira_approval_review"')
    expect((prompt as { content: string }).content).toContain('"recentUserIntents"')
    expect((prompt as { content: string }).content).not.toContain('TRANSCRIPT START')
    expect(reviewer.onDeny).toBe('deny')
    expect(reviewer.onFailure).toBe('ask')
  })

  it('returns invalid_result when the reviewer does not submit a decision', async () => {
    const reviewer = autoReview({
      runner: async () => ({ output: [assistant('I forgot to submit.')] }),
    })

    await expect(reviewer.review(request, {
      input: [],
      runner: approvingRunner(),
    })).resolves.toMatchObject({
      failure: { type: 'invalid_result' },
      type: 'failure',
    })
  })

  it('rejects multiple submitted decisions', async () => {
    const runner: Runner = async (context) => {
      const submit = context.tools.find(tool => tool.function.name === 'submit_review')
      const assessment = {
        rationale: 'Duplicated.',
        riskLevel: 'low',
        type: 'approve',
        userAuthorization: 'high',
      }
      await submit?.execute(assessment, toolOptions)
      await submit?.execute(assessment, toolOptions)
      return { output: [assistant('Submitted twice.')] }
    }
    const reviewer = autoReview({ runner })

    await expect(reviewer.review(request, { input: [], runner })).resolves.toMatchObject({
      failure: { type: 'invalid_result' },
      type: 'failure',
    })
  })

  it('times out a reviewer run', async () => {
    const runner: Runner = async context => new Promise((resolve) => {
      context.abortSignal?.addEventListener('abort', () => resolve({ output: [] }), { once: true })
    })
    const reviewer = autoReview({ runner, timeoutMs: 5 })

    await expect(reviewer.review(request, {
      input: [],
      runner,
    })).resolves.toMatchObject({
      failure: { type: 'timeout' },
      type: 'failure',
    })
  })

  it('times out an unresolved context transformation', async () => {
    let transformSignal: AbortSignal | undefined
    const reviewer = autoReview({
      timeoutMs: 5,
      transformContext: async (_input, _request, context) => {
        transformSignal = context.signal
        return new Promise<never>(() => {})
      },
    })

    await expect(reviewer.review(request, {
      input: [],
      runner: approvingRunner(),
    })).resolves.toMatchObject({
      failure: { type: 'timeout' },
      type: 'failure',
    })
    expect(transformSignal?.aborted).toBe(true)
  })

  it('serializes reviews and cancels a queued review immediately', async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let calls = 0
    const runner: Runner = async (context) => {
      calls++
      if (calls === 1)
        await gate
      const submit = context.tools.find(tool => tool.function.name === 'submit_review')
      await submit?.execute({
        rationale: 'Allowed.',
        riskLevel: 'low',
        type: 'approve',
        userAuthorization: 'high',
      }, toolOptions)
      return { output: [assistant('Submitted.')] }
    }
    const reviewer = autoReview({ runner })
    const first = reviewer.review(request, { input: [], runner })
    const controller = new AbortController()
    const second = reviewer.review(
      { ...request, requestId: 'request-2' },
      { input: [], runner, signal: controller.signal },
    )

    await vi.waitFor(() => expect(calls).toBe(1))
    controller.abort('cancelled')
    await expect(second).rejects.toBe('cancelled')
    expect(calls).toBe(1)

    release()
    await expect(first).resolves.toMatchObject({ type: 'approve' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(calls).toBe(1)
  })

  it('reserves the submit_review tool name', () => {
    const tool = {
      execute: () => '',
      function: { name: 'submit_review', parameters: {} },
      type: 'function',
    } as Tool

    expect(() => autoReview({ tools: [tool] })).toThrow('reserved')
  })
})
