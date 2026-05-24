import type { AgentEvent, ItemParam } from '@apeira/core'
import type { Tool } from '@xsai/shared-chat'

import { createAgent } from '@apeira/core'
import { rawTool } from '@xsai/tool'
import { describe, expect, it } from 'vitest'

import { createToolApprovalPolicy, toolApproval, toolApprovalHints, withToolApprovalHints } from '../src/index'

const message = (content: string): ItemParam => ({
  content,
  role: 'user',
  type: 'message',
})

const assistantMessage = (text: string) => ({
  content: [{ text, type: 'output_text' }],
  phase: 'final_answer',
  role: 'assistant',
  type: 'message',
})

const sse = (event: unknown) =>
  `data: ${JSON.stringify(event)}\n\n`

const createResponseStream = (output: unknown) => {
  const encoder = new TextEncoder()

  return new Response(new ReadableStream({
    start: (controller) => {
      controller.enqueue(encoder.encode(sse({ type: 'response.created' })))
      controller.enqueue(encoder.encode(sse({
        item: output,
        output_index: 0,
        type: 'response.output_item.done',
      })))
      controller.enqueue(encoder.encode(sse({
        response: {
          output: [output],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
        },
        type: 'response.completed',
      })))
      controller.close()
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

const createToolCallResponsesFetch = (toolName: string, args: Record<string, unknown> = {}) => {
  let calls = 0
  const inputs: unknown[][] = []

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input: unknown[] }
    inputs.push(body.input)
    calls += 1

    if (calls % 2 === 1) {
      return createResponseStream({
        arguments: JSON.stringify(args),
        call_id: `call_${calls}`,
        id: `fc_${calls}`,
        name: toolName,
        status: 'completed',
        type: 'function_call',
      })
    }

    return createResponseStream(assistantMessage(`done ${calls}`))
  }

  return {
    fetch,
    inputs,
  }
}

const createSequentialToolCallResponsesFetch = (toolName: string, calls: Array<Record<string, unknown>>) => {
  let index = 0
  const fetch: typeof globalThis.fetch = async () => {
    const args = calls[index]
    index += 1

    if (args != null) {
      return createResponseStream({
        arguments: JSON.stringify(args),
        call_id: `call_${index}`,
        id: `fc_${index}`,
        name: toolName,
        status: 'completed',
        type: 'function_call',
      })
    }

    return createResponseStream(assistantMessage(`done ${index}`))
  }

  return { fetch }
}

const readEventStream = async (stream: ReadableStream<AgentEvent>) => {
  const events: AgentEvent[] = []
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done)
        break

      events.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }

  return events
}

const createMemoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => values.get(key),
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    values,
  }
}

const createCommandTool = (calls: string[]): Tool =>
  rawTool({
    execute: (input: unknown) => {
      calls.push(JSON.stringify(input))
      return 'ok'
    },
    name: 'bash',
    parameters: {
      properties: {
        command: { type: 'string' },
      },
      required: ['command'],
      type: 'object',
    },
  })

const commandApprovalHints = ({ input, toolName }: { input: unknown, toolName: string }) => {
  if (toolName !== 'bash')
    return

  const { command } = input as { command?: string }
  return {
    risk: 'execute' as const,
    source: 'test-tools',
    targets: command == null ? [] : [{ operation: 'execute', type: 'command' as const, value: command }],
  }
}

const createAgentWithApproval = (
  approval: ReturnType<typeof toolApproval>,
  tool: Tool,
  fetch: typeof globalThis.fetch,
  storage = createMemoryStorage(),
) => createAgent({
  instructions: 'Use tools.',
  name: 'approval-test',
  options: {
    apiKey: 'test',
    baseURL: 'https://example.test/v1/',
    fetch,
    model: 'test-model',
  },
  plugins: [{
    name: 'tools',
    resolveTools: () => [tool],
  }, toolApprovalHints(commandApprovalHints), approval, {
    name: 'storage',
    storage,
  }],
})

describe('toolApproval', () => {
  it('turns deny decisions into core-level blocks', async () => {
    const calls: string[] = []
    const responsesFetch = createToolCallResponsesFetch('bash', { command: 'git status' })
    const approval = toolApproval({
      mode: 'ask',
      policy: () => ({ message: 'no', type: 'deny' }),
    })
    const agent = createAgentWithApproval(approval, createCommandTool(calls), responsesFetch.fetch)

    await readEventStream(agent.run(message('run command')))

    expect(calls).toEqual([])
  })

  it('does not let onDecision failures interrupt approved tool calls', async () => {
    const calls: string[] = []
    const responsesFetch = createToolCallResponsesFetch('bash', { command: 'git status' })
    const approval = toolApproval({
      mode: 'ask',
      onDecision: () => {
        throw new Error('audit sink failed')
      },
      policy: () => ({ scope: 'once', type: 'allow' }),
    })
    const agent = createAgentWithApproval(approval, createCommandTool(calls), responsesFetch.fetch)

    await readEventStream(agent.run(message('run command')))

    expect(calls).toEqual([JSON.stringify({ command: 'git status' })])
  })

  it('does not remember once approvals', async () => {
    const calls: string[] = []
    let approvals = 0
    const responsesFetch = createToolCallResponsesFetch('bash', { command: 'git status' })
    const approval = toolApproval({
      mode: 'ask',
      policy: () => {
        approvals += 1
        return approvals === 1
          ? { scope: 'once', type: 'allow' }
          : { type: 'ask' }
      },
    })
    const agent = createAgentWithApproval(approval, createCommandTool(calls), responsesFetch.fetch)

    await readEventStream(agent.run(message('run command')))
    await readEventStream(agent.run(message('run command again')))

    expect(calls).toHaveLength(1)
    expect(approvals).toBe(2)
  })

  it('remembers turn approvals within the same turn only', async () => {
    const calls: string[] = []
    let approvals = 0
    const responsesFetch = createSequentialToolCallResponsesFetch('bash', [
      { command: 'git status' },
      { command: 'git status' },
    ])
    const approval = toolApproval({
      mode: 'ask',
      policy: () => {
        approvals += 1
        return approvals === 1
          ? { scope: 'turn', type: 'allow' }
          : { type: 'ask' }
      },
    })
    const agent = createAgentWithApproval(approval, createCommandTool(calls), responsesFetch.fetch)

    await readEventStream(agent.run(message('run command')))

    expect(calls).toHaveLength(2)
  })

  it('persists conversation approvals in plugin private state', async () => {
    const calls: string[] = []
    let approvals = 0
    const storage = createMemoryStorage()
    const responsesFetch = createToolCallResponsesFetch('bash', { command: 'git status' })
    const approval = toolApproval({
      mode: 'ask',
      policy: () => {
        approvals += 1
        return approvals === 1
          ? { scope: 'conversation', type: 'allow' }
          : { type: 'ask' }
      },
    })
    const agent = createAgentWithApproval(approval, createCommandTool(calls), responsesFetch.fetch, storage)

    await readEventStream(agent.run(message('run command')))
    await readEventStream(agent.run(message('run command again')))

    const stored = JSON.parse(String(storage.values.get('["approval-test","default"]'))) as { plugins?: Record<string, unknown> }
    expect(calls).toHaveLength(2)
    expect(stored.plugins?.['@apeira/plugin-tool-approval']).toBeDefined()
  })

  it('clears remembered conversation approvals before the next tool call', async () => {
    const calls: string[] = []
    let approvals = 0
    const responsesFetch = createToolCallResponsesFetch('bash', { command: 'git status' })
    const approval = toolApproval({
      mode: 'ask',
      policy: () => {
        approvals += 1
        return approvals === 1
          ? { scope: 'conversation', type: 'allow' }
          : { type: 'ask' }
      },
    })
    const agent = createAgentWithApproval(approval, createCommandTool(calls), responsesFetch.fetch)

    await readEventStream(agent.run(message('run command')))
    approval.clearHistory()
    await readEventStream(agent.run(message('run command again')))

    expect(calls).toHaveLength(1)
    expect(approvals).toBe(2)
  })

  it('lets runtime deny override old conversation approvals', async () => {
    const calls: string[] = []
    const responsesFetch = createToolCallResponsesFetch('bash', { command: 'git status' })
    const approval = toolApproval({
      mode: 'ask',
      policy: () => ({ scope: 'conversation', type: 'allow' }),
    })
    const agent = createAgentWithApproval(approval, createCommandTool(calls), responsesFetch.fetch)

    await readEventStream(agent.run(message('run command')))
    approval.setPolicy(() => ({ type: 'deny' }))
    await readEventStream(agent.run(message('run command again')))

    expect(calls).toHaveLength(1)
  })

  it('does not reuse approval across different inputs', async () => {
    const calls: string[] = []
    let approvals = 0
    const responsesFetch = createToolCallResponsesFetch('bash', { command: approvals === 0 ? 'git status' : 'rm -rf .' })
    const approval = toolApproval({
      mode: 'ask',
      policy: (request) => {
        approvals += 1
        return request.input != null && (request.input as { command?: string }).command === 'git status'
          ? { scope: 'conversation', type: 'allow' }
          : { type: 'ask' }
      },
    })
    const tool = createCommandTool(calls)
    const agent = createAgentWithApproval(approval, tool, responsesFetch.fetch)

    await readEventStream(agent.run(message('run safe command')))
    const nextFetch = createToolCallResponsesFetch('bash', { command: 'rm -rf .' })
    const nextAgent = createAgentWithApproval(approval, tool, nextFetch.fetch)
    await readEventStream(nextAgent.run(message('run unsafe command')))

    expect(calls).toEqual([JSON.stringify({ command: 'git status' })])
  })

  it('creates a lightweight rule-based approval policy', () => {
    const policy = createToolApprovalPolicy([
      { decision: { type: 'deny' }, risk: 'execute' },
      { decision: { scope: 'conversation', type: 'allow' }, toolName: 'read' },
    ])
    const tool = createCommandTool([])

    expect(policy({
      agentName: 'agent',
      context: {},
      hints: {},
      input: {},
      risk: 'execute',
      sessionId: 'session',
      signal: new AbortController().signal,
      targets: [],
      tool,
      toolName: 'bash',
      turnId: 'turn',
    })).toEqual({ type: 'deny' })
    expect(policy({
      agentName: 'agent',
      context: {},
      hints: {},
      input: {},
      risk: 'read',
      sessionId: 'session',
      signal: new AbortController().signal,
      targets: [],
      tool,
      toolName: 'read',
      turnId: 'turn',
    })).toEqual({ scope: 'conversation', type: 'allow' })
  })

  it('can wrap a plugin with approval hints without the wrapped plugin knowing approval exists', async () => {
    const calls: string[] = []
    const seenRisks: string[] = []
    const responsesFetch = createToolCallResponsesFetch('bash', { command: 'git status' })
    const approval = toolApproval({
      mode: 'ask',
      policy: (request) => {
        seenRisks.push(request.risk)
        return { scope: 'once', type: 'allow' }
      },
    })
    const toolsPlugin = withToolApprovalHints({
      name: 'plain-tools',
      resolveTools: () => [createCommandTool(calls)],
    }, commandApprovalHints)
    const agent = createAgent({
      instructions: 'Use tools.',
      name: 'approval-wrapper-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [toolsPlugin, approval],
    })

    await readEventStream(agent.run(message('run command')))

    expect(calls).toHaveLength(1)
    expect(seenRisks).toEqual(['execute'])
  })
})
