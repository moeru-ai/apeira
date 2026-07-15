import type { AgentInput, Runner } from '../../src/index'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { asTool, createAgent, user } from '../../src/index'

const executeOptions = {
  messages: [],
  toolCallId: 'call-1',
}

const createTestAgent = (
  runner: Runner,
  initialState: { agentDescription?: string, agentName?: string } = { agentDescription: 'Test agent', agentName: 'test-agent' },
) =>
  createAgent({
    initialState,
    instructions: 'test',
    runner,
  })

const textRunner = (text: string, seenInput?: (input: readonly AgentInput[]) => void): Runner =>
  async ({ channel, input, turnId }) => {
    seenInput?.(input)
    await channel.emit('apeira', { delta: text, turnId, type: 'text.delta' })
    await channel.emit('apeira', { content: text, turnId, type: 'text.done' })
    return { output: [] }
  }

describe('asTool', () => {
  it('derives tool metadata and executes default parameters', async () => {
    let received: readonly AgentInput[] | undefined
    const agent = createTestAgent(textRunner('hello', input => received = input))
    const tool = asTool(agent)

    expect(tool.function).toMatchObject({
      description: 'Test agent',
      name: 'test-agent',
      parameters: {
        properties: { input: { type: 'string' } },
        required: ['input'],
        type: 'object',
      },
      strict: true,
    })
    await expect(tool.execute({ input: 'world' }, executeOptions)).resolves.toBe('hello')
    expect(received).toContainEqual(user('world'))
  })

  it('supports schema and input conversion overrides', async () => {
    let received: readonly AgentInput[] | undefined
    const agent = createTestAgent(textRunner('translated', input => received = input))
    const tool = asTool(agent, {
      description: 'Translate text',
      name: 'translate',
      parameters: z.object({ text: z.string() }),
      strict: false,
      toAgentInput: ({ text }) => user(text),
    })

    expect(tool.function).toMatchObject({
      description: 'Translate text',
      name: 'translate',
      strict: false,
    })
    await expect(tool.execute({ text: 'hello' }, executeOptions)).resolves.toBe('translated')
    expect(received).toContainEqual(user('hello'))
  })

  it('requires a valid tool name', () => {
    const agent = createTestAgent(async () => ({ output: [] }), {})

    expect(() => asTool(agent)).toThrow('options.name or agent.state.agentName')
    expect(() => asTool(agent, { name: 'invalid name' })).toThrow('Invalid tool name')
    expect(() => asTool(agent, { name: 'a'.repeat(65) })).toThrow('Invalid tool name')
  })

  it('forwards abort signals and rejects failed or aborted runs', async () => {
    const failure = new Error('runner failed')
    const failedAgent = createTestAgent(async () => {
      throw failure
    })
    const failedTool = asTool(failedAgent)
    await expect(failedTool.execute({ input: 'fail' }, executeOptions)).rejects.toBe(failure)

    let resolveStarted!: () => void
    const started = new Promise<void>(resolve => resolveStarted = resolve)
    const abortedAgent = createTestAgent(async ({ abortSignal }) => {
      resolveStarted()
      await new Promise<void>(resolve => abortSignal?.addEventListener('abort', () => resolve(), { once: true }))
      return { output: [] }
    })
    const abortedTool = asTool(abortedAgent)
    const controller = new AbortController()
    const result = abortedTool.execute(
      { input: 'abort' },
      { ...executeOptions, abortSignal: controller.signal },
    )

    await started
    controller.abort('cancelled')
    await expect(result).rejects.toBe('cancelled')
  })
})
