import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mcp } from '../src/index'

const fixtures = vi.hoisted(() => ({
  clients: [] as MockClientFixture[],
  instances: [] as MockClient[],
}))

interface MockClient {
  callTool: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  listTools: ReturnType<typeof vi.fn>
}

interface MockClientFixture {
  callTool?: ReturnType<typeof vi.fn>
  connect?: ReturnType<typeof vi.fn>
  listTools?: ReturnType<typeof vi.fn>
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class Client {
    callTool: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    listTools: ReturnType<typeof vi.fn>

    constructor() {
      const fixture = fixtures.clients.shift() ?? {}

      this.connect = fixture.connect ?? vi.fn(async () => undefined)
      this.listTools = fixture.listTools ?? vi.fn(async () => ({ tools: [] }))
      this.callTool = fixture.callTool ?? vi.fn(async () => ({ content: [] }))

      fixtures.instances.push(this)
    }
  }

  return { Client }
})

const createTransport = () => ({
  close: vi.fn(async () => undefined),
  send: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
}) satisfies Transport

const createResolveOptions = () => ({
  agentName: 'agent',
  context: {},
  input: [{ content: 'hello', role: 'user' as const, type: 'message' as const }],
  sessionId: 'session',
  signal: new AbortController().signal,
  tools: [],
  turnId: 'turn',
  turnInput: { content: 'hello', role: 'user' as const, type: 'message' as const },
})

describe('mcp', () => {
  beforeEach(() => {
    fixtures.clients.length = 0
    fixtures.instances.length = 0
  })

  it('maps MCP tools to prefixed xsai tools', async () => {
    fixtures.clients.push({
      listTools: vi.fn(async () => ({
        tools: [{
          description: 'Search documentation.',
          inputSchema: {
            properties: { query: { type: 'string' } },
            required: ['query'],
            type: 'object',
          },
          name: 'search',
        }],
      })),
    })


    const plugin = mcp({
      servers: {
        docs: {
          createTransport,
          type: 'custom',
        },
      },
    })
    const tools = await plugin.resolveTools?.(createResolveOptions())

    expect(tools?.[0]).toMatchObject({
      function: {
        description: 'Search documentation.',
        name: 'mcp_docs__search',
        parameters: {
          properties: { query: { type: 'string' } },
          required: ['query'],
          type: 'object',
        },
      },
      type: 'function',
    })
  })

  it('filters tools by include, exclude, and custom filter', async () => {
    fixtures.clients.push({
      listTools: vi.fn(async () => ({
        tools: [
          { inputSchema: { type: 'object' }, name: 'keep' },
          { inputSchema: { type: 'object' }, name: 'skip_excluded' },
          { inputSchema: { type: 'object' }, name: 'skip_filtered' },
          { inputSchema: { type: 'object' }, name: 'skip_not_included' },
        ],
      })),
    })


    const plugin = mcp({
      servers: {
        docs: {
          createTransport,
          excludeTools: ['skip_excluded'],
          includeTools: ['keep', 'skip_excluded', 'skip_filtered'],
          toolFilter: tool => tool.name !== 'skip_filtered',
          type: 'custom',
        },
      },
    })
    const tools = await plugin.resolveTools?.(createResolveOptions())

    expect(tools?.map(tool => tool.function.name)).toEqual(['mcp_docs__keep'])
  })

  it('calls the original MCP tool and returns structured results', async () => {
    const callTool = vi.fn(async () => ({
      content: [{ text: 'Found result.', type: 'text' }],
      structuredContent: { count: 1 },
    }))
    fixtures.clients.push({
      callTool,
      listTools: vi.fn(async () => ({
        tools: [{
          inputSchema: { type: 'object' },
          name: 'search',
        }],
      })),
    })


    const plugin = mcp({
      servers: {
        docs: {
          createTransport,
          type: 'custom',
        },
      },
    })
    const tools = await plugin.resolveTools?.(createResolveOptions())
    const result = await tools?.[0]?.execute({ query: 'apeira' }, {
      messages: [],
      toolCallId: 'call_1',
    })

    expect(callTool).toHaveBeenCalledWith(
      {
        arguments: { query: 'apeira' },
        name: 'search',
      },
      undefined,
      { signal: undefined, timeout: undefined },
    )
    expect(result).toEqual({
      content: [{ text: 'Found result.', type: 'text' }],
      structuredContent: { count: 1 },
    })
  })

  it('returns MCP isError tool results without throwing', async () => {
    fixtures.clients.push({
      callTool: vi.fn(async () => ({
        content: [{ text: 'Permission denied.', type: 'text' }],
        isError: true,
      })),
      listTools: vi.fn(async () => ({
        tools: [{ inputSchema: { type: 'object' }, name: 'danger' }],
      })),
    })


    const plugin = mcp({
      servers: {
        local: {
          createTransport,
          type: 'custom',
        },
      },
    })
    const tools = await plugin.resolveTools?.(createResolveOptions())

    await expect(tools?.[0]?.execute({}, { messages: [], toolCallId: 'call_1' }))
      .resolves
      .toEqual({
        content: [{ text: 'Permission denied.', type: 'text' }],
        isError: true,
      })
  })

  it('uses a model-visible error result when onError handles tool call failures without a return value', async () => {
    const onError = vi.fn()

    fixtures.clients.push({
      callTool: vi.fn(async () => {
        throw new Error('network down')
      }),
      listTools: vi.fn(async () => ({
        tools: [{ inputSchema: { type: 'object' }, name: 'search' }],
      })),
    })


    const plugin = mcp({
      onError,
      servers: {
        local: {
          createTransport,
          type: 'custom',
        },
      },
    })
    const tools = await plugin.resolveTools?.(createResolveOptions())

    await expect(tools?.[0]?.execute({}, { messages: [], toolCallId: 'call_1' }))
      .resolves
      .toEqual({
        content: [{
          text: 'MCP local/search callTool failed: network down',
          type: 'text',
        }],
        isError: true,
      })
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      operation: 'callTool',
      serverId: 'local',
      toolName: 'search',
    })
  })

  it('requires onError to return tools or undefined for tool discovery failures', async () => {
    fixtures.clients.push({
      listTools: vi.fn(async () => {
        throw new Error('bad list')
      }),
    })


    const plugin = mcp({
      onError: () => ({ invalid: true }),
      servers: {
        local: {
          createTransport,
          type: 'custom',
        },
      },
    })

    await expect(plugin.resolveTools?.(createResolveOptions()))
      .rejects
      .toThrow('MCP onError must return a Tool[] or undefined for listTools errors.')
  })

  it('caches tools by default', async () => {
    const listTools = vi.fn()
      .mockResolvedValueOnce({ tools: [{ inputSchema: { type: 'object' }, name: 'first' }] })
      .mockResolvedValueOnce({ tools: [{ inputSchema: { type: 'object' }, name: 'second' }] })
    fixtures.clients.push({ listTools })


    const plugin = mcp({
      servers: {
        local: {
          createTransport,
          type: 'custom',
        },
      },
    })

    expect((await plugin.resolveTools?.(createResolveOptions()))?.map(tool => tool.function.name))
      .toEqual(['mcp_local__first'])
    expect((await plugin.resolveTools?.(createResolveOptions()))?.map(tool => tool.function.name))
      .toEqual(['mcp_local__first'])

    expect(listTools).toHaveBeenCalledTimes(1)
    expect(fixtures.instances[0]?.connect).toHaveBeenCalledTimes(1)
  })

  it('refreshes tools on turn when configured', async () => {
    const listTools = vi.fn()
      .mockResolvedValueOnce({ tools: [{ inputSchema: { type: 'object' }, name: 'first' }] })
      .mockResolvedValueOnce({ tools: [{ inputSchema: { type: 'object' }, name: 'second' }] })
    fixtures.clients.push({ listTools })


    const plugin = mcp({
      refreshTools: 'turn',
      servers: {
        local: {
          createTransport,
          type: 'custom',
        },
      },
    })

    expect((await plugin.resolveTools?.(createResolveOptions()))?.map(tool => tool.function.name))
      .toEqual(['mcp_local__first'])

    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      input: { content: 'hello', role: 'user', type: 'message' },
      sessionId: 'session',
      signal: new AbortController().signal,
      turnId: 'turn',
    })

    expect((await plugin.resolveTools?.(createResolveOptions()))?.map(tool => tool.function.name))
      .toEqual(['mcp_local__second'])
    expect(listTools).toHaveBeenCalledTimes(2)
  })

  it('keeps cached tools when turn refresh fails', async () => {
    const listTools = vi.fn()
      .mockResolvedValueOnce({ tools: [{ inputSchema: { type: 'object' }, name: 'first' }] })
      .mockRejectedValueOnce(new Error('refresh failed'))
    fixtures.clients.push({ listTools })


    const plugin = mcp({
      refreshTools: 'turn',
      servers: {
        local: {
          createTransport,
          type: 'custom',
        },
      },
    })

    expect((await plugin.resolveTools?.(createResolveOptions()))?.map(tool => tool.function.name))
      .toEqual(['mcp_local__first'])

    await expect(plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      input: { content: 'hello', role: 'user', type: 'message' },
      sessionId: 'session',
      signal: new AbortController().signal,
      turnId: 'turn',
    })).resolves.toBeUndefined()

    expect((await plugin.resolveTools?.(createResolveOptions()))?.map(tool => tool.function.name))
      .toEqual(['mcp_local__first'])
    expect(listTools).toHaveBeenCalledTimes(2)
  })
})
