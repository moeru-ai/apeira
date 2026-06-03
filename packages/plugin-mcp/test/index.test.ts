import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { mcp } from '../src/index'

const fixtures = vi.hoisted(() => ({
  clients: [] as MockClientFixture[],
  httpTransports: [] as unknown[],
  instances: [] as MockClient[],
  sseTransports: [] as unknown[],
  stdioTransports: [] as unknown[],
  wsTransports: [] as unknown[],
}))

interface MockClient {
  callTool: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  listTools: ReturnType<typeof vi.fn>
  setNotificationHandler?: ReturnType<typeof vi.fn>
}

interface MockClientFixture {
  callTool?: ReturnType<typeof vi.fn>
  close?: ReturnType<typeof vi.fn>
  connect?: ReturnType<typeof vi.fn>
  listTools?: ReturnType<typeof vi.fn>
  setNotificationHandler?: ReturnType<typeof vi.fn>
}

const createTransport = () => ({
  close: vi.fn(async () => undefined),
  send: vi.fn(async () => undefined),
  start: vi.fn(async () => undefined),
}) satisfies Transport

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class Client {
    callTool: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    connect: ReturnType<typeof vi.fn>
    listTools: ReturnType<typeof vi.fn>
    setNotificationHandler: ReturnType<typeof vi.fn>

    constructor() {
      const fixture = fixtures.clients.shift() ?? {}

      this.close = fixture.close ?? vi.fn(async () => undefined)
      this.connect = fixture.connect ?? vi.fn(async () => undefined)
      this.listTools = fixture.listTools ?? vi.fn(async () => ({ tools: [] }))
      this.callTool = fixture.callTool ?? vi.fn(async () => ({ content: [] }))
      this.setNotificationHandler = fixture.setNotificationHandler ?? vi.fn()

      fixtures.instances.push(this)
    }
  }

  return { Client }
})

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: class {
    constructor(params: unknown) {
      fixtures.stdioTransports.push(params)
      return createTransport()
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, options: unknown) {
      fixtures.httpTransports.push({ options, url: url.toString() })
      return createTransport()
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: class {
    constructor(url: URL, options: unknown) {
      fixtures.sseTransports.push({ options, url: url.toString() })
      return createTransport()
    }
  },
}))

vi.mock('@modelcontextprotocol/sdk/client/websocket.js', () => ({
  WebSocketClientTransport: class {
    constructor(url: URL) {
      fixtures.wsTransports.push(url.toString())
      return createTransport()
    }
  },
}))

const createState = () => ({})

describe('mcp', () => {
  beforeEach(() => {
    fixtures.clients.length = 0
    fixtures.httpTransports.length = 0
    fixtures.instances.length = 0
    fixtures.sseTransports.length = 0
    fixtures.stdioTransports.length = 0
    fixtures.wsTransports.length = 0
    vi.unstubAllEnvs()
  })

  it('maps .mcp.json stdio servers to prefixed xsai tools', async () => {
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
      mcpServers: {
        docs: {
          args: ['server.js'],
          command: 'node',
        },
      },
    })
    const tools = await plugin.extendTools?.(createState())

    expect(fixtures.stdioTransports[0]).toEqual({
      args: ['server.js'],
      command: 'node',
      cwd: undefined,
      env: undefined,
      stderr: undefined,
    })
    expect(tools?.[0]).toMatchObject({
      function: {
        description: 'Search documentation.',
        name: 'mcp__docs__search',
        parameters: {
          properties: { query: { type: 'string' } },
          required: ['query'],
          type: 'object',
        },
      },
      type: 'function',
    })
  })

  it('calls the original MCP tool with the configured timeout', async () => {
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
      mcpServers: {
        docs: {
          command: 'node',
          timeout: 600_000,
        },
      },
    })
    const tools = await plugin.extendTools?.(createState())
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
      { timeout: 600_000 },
    )
    expect(result).toEqual({
      content: [{ text: 'Found result.', type: 'text' }],
      structuredContent: { count: 1 },
    })
  })

  it('maps http and streamable-http servers to StreamableHTTP transports', async () => {
    fixtures.clients.push({}, {})

    const plugin = mcp({
      mcpServers: {
        docs: {
          headers: { Authorization: 'Bearer token' },
          type: 'http',
          url: 'https://example.com/mcp',
        },
        search: {
          type: 'streamable-http',
          url: 'https://example.com/search',
        },
      },
    })

    await plugin.extendTools?.(createState())

    expect(fixtures.httpTransports).toEqual([
      {
        options: {
          requestInit: {
            headers: { Authorization: 'Bearer token' },
          },
        },
        url: 'https://example.com/mcp',
      },
      {
        options: undefined,
        url: 'https://example.com/search',
      },
    ])
  })

  it('passes headers to SSE event stream and request transports', async () => {
    fixtures.clients.push({})

    const plugin = mcp({
      mcpServers: {
        events: {
          headers: { 'X-API-Key': 'secret' },
          type: 'sse',
          url: 'https://example.com/sse',
        },
      },
    })

    await plugin.extendTools?.(createState())

    expect(fixtures.sseTransports[0]).toMatchObject({
      options: {
        requestInit: {
          headers: { 'X-API-Key': 'secret' },
        },
      },
      url: 'https://example.com/sse',
    })
    expect((fixtures.sseTransports[0] as { options: { eventSourceInit: { fetch: unknown } } }).options.eventSourceInit.fetch)
      .toEqual(expect.any(Function))
  })

  it('maps ws servers to WebSocketClientTransport', async () => {
    fixtures.clients.push({})

    const plugin = mcp({
      mcpServers: {
        events: {
          type: 'ws',
          url: 'ws://localhost:8080/mcp',
        },
      },
    })

    await plugin.extendTools?.(createState())

    expect(fixtures.wsTransports).toEqual(['ws://localhost:8080/mcp'])
  })

  it('expands environment variables in .mcp.json string fields', async () => {
    vi.stubEnv('MCP_COMMAND', 'node')
    vi.stubEnv('MCP_TOKEN', 'token')
    fixtures.clients.push({})

    const plugin = mcp({
      mcpServers: {
        local: {
          args: [`${'$'}{MCP_SCRIPT:-server.js}`],
          command: `${'$'}{MCP_COMMAND}`,
          env: { API_TOKEN: `${'$'}{MCP_TOKEN}` },
        },
      },
    })

    await plugin.extendTools?.(createState())

    expect(fixtures.stdioTransports[0]).toMatchObject({
      args: ['server.js'],
      command: 'node',
      env: { API_TOKEN: 'token' },
    })
  })

  it('throws once with all missing required environment variables', () => {
    expect(() => mcp({
      mcpServers: {
        local: {
          command: `${'$'}{MISSING_COMMAND}`,
          env: {
            API_TOKEN: `${'$'}{MISSING_TOKEN}`,
          },
        },
      },
    })).toThrow('Missing environment variables in MCP config: MISSING_COMMAND, MISSING_TOKEN')
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
      mcpServers: {
        local: {
          command: 'node',
        },
      },
    })
    const tools = await plugin.extendTools?.(createState())

    await expect(tools?.[0]?.execute({}, { messages: [], toolCallId: 'call_1' }))
      .resolves
      .toEqual({
        content: [{ text: 'Permission denied.', type: 'text' }],
        isError: true,
      })
  })

  it('returns model-visible error results for direct MCP tool call transport failures', async () => {
    fixtures.clients.push({
      callTool: vi.fn(async () => {
        throw new Error('network down')
      }),
      listTools: vi.fn(async () => ({
        tools: [{ inputSchema: { type: 'object' }, name: 'search' }],
      })),
    })

    const plugin = mcp({
      mcpServers: {
        local: {
          command: 'node',
        },
      },
    })
    const tools = await plugin.extendTools?.(createState())

    await expect(tools?.[0]?.execute({}, { messages: [], toolCallId: 'call_1' }))
      .resolves
      .toEqual({
        content: [{
          text: 'MCP local/search callTool failed: network down',
          type: 'text',
        }],
        isError: true,
      })
  })

  it('caches tools by default', async () => {
    const listTools = vi.fn()
      .mockResolvedValueOnce({ tools: [{ inputSchema: { type: 'object' }, name: 'first' }] })
      .mockResolvedValueOnce({ tools: [{ inputSchema: { type: 'object' }, name: 'second' }] })
    fixtures.clients.push({ listTools })

    const plugin = mcp({
      mcpServers: {
        local: {
          command: 'node',
        },
      },
    })

    expect((await plugin.extendTools?.(createState()))?.map(tool => tool.function.name))
      .toEqual(['mcp__local__first'])
    expect((await plugin.extendTools?.(createState()))?.map(tool => tool.function.name))
      .toEqual(['mcp__local__first'])

    expect(listTools).toHaveBeenCalledTimes(1)
    expect(fixtures.instances[0]?.connect).toHaveBeenCalledTimes(1)
  })

  it('lists tools across paginated MCP responses', async () => {
    const listTools = vi.fn()
      .mockResolvedValueOnce({
        nextCursor: 'next',
        tools: [{ inputSchema: { type: 'object' }, name: 'first' }],
      })
      .mockResolvedValueOnce({
        tools: [{ inputSchema: { type: 'object' }, name: 'second' }],
      })
    fixtures.clients.push({ listTools })

    const plugin = mcp({
      mcpServers: {
        local: {
          command: 'node',
        },
      },
    })
    const resolveOptions = createState()

    expect((await plugin.extendTools?.(resolveOptions))?.map(tool => tool.function.name))
      .toEqual(['mcp__local__first', 'mcp__local__second'])
    expect(listTools).toHaveBeenNthCalledWith(1, undefined, {
      timeout: undefined,
    })
    expect(listTools).toHaveBeenNthCalledWith(2, { cursor: 'next' }, {
      timeout: undefined,
    })
  })

  it('keeps healthy server tools when another server fails during resolution', async () => {
    fixtures.clients.push({
      listTools: vi.fn(async () => {
        throw new Error('bad list')
      }),
    }, {
      listTools: vi.fn(async () => ({
        tools: [{ inputSchema: { type: 'object' }, name: 'search' }],
      })),
    })

    const plugin = mcp({
      mcpServers: {
        broken: {
          command: 'node',
        },
        docs: {
          command: 'node',
        },
      },
    })

    expect((await plugin.extendTools?.(createState()))?.map(tool => tool.function.name))
      .toEqual(['mcp__docs__search'])
  })

  it('exposes stable progressive discovery tools when enabled', async () => {
    const listTools = vi.fn(async () => ({
      tools: [{
        description: 'Search documentation.',
        inputSchema: {
          properties: { query: { type: 'string' } },
          required: ['query'],
          type: 'object',
        },
        name: 'search',
      }],
    }))
    const callTool = vi.fn(async () => ({
      content: [{ text: 'Found result.', type: 'text' }],
    }))
    fixtures.clients.push({ callTool, listTools })

    const plugin = mcp({
      mcpServers: {
        docs: {
          command: 'node',
          timeout: 600_000,
        },
      },
      progressiveToolDiscovery: true,
    })
    const tools = await plugin.extendTools?.(createState())

    expect(tools?.map(tool => tool.function.name)).toEqual([
      'search_mcp_tools',
      'get_mcp_tool_details',
      'call_mcp_tool',
    ])
    expect(listTools).not.toHaveBeenCalled()

    const searchResult = await tools?.[0]?.execute({ query: 'documentation' }, {
      messages: [],
      toolCallId: 'call_1',
    })

    expect(searchResult).toEqual({
      matches: [{
        description: 'Search documentation.',
        name: 'mcp__docs__search',
        serverId: 'docs',
        toolName: 'search',
      }],
      query: 'documentation',
      serverFailures: [],
      total: 1,
    })

    const details = await tools?.[1]?.execute({ name: 'mcp__docs__search' }, {
      messages: [],
      toolCallId: 'call_2',
    })

    expect(details).toEqual({
      description: 'Search documentation.',
      inputSchema: {
        properties: { query: { type: 'string' } },
        required: ['query'],
        type: 'object',
      },
      name: 'mcp__docs__search',
      serverId: 'docs',
      toolName: 'search',
    })

    await expect(tools?.[2]?.execute({
      arguments: { query: 'apeira' },
      name: 'mcp__docs__search',
    }, {
      messages: [],
      toolCallId: 'call_3',
    })).resolves.toEqual({
      content: [{ text: 'Found result.', type: 'text' }],
    })

    expect(callTool).toHaveBeenCalledWith(
      {
        arguments: { query: 'apeira' },
        name: 'search',
      },
      undefined,
      { timeout: 600_000 },
    )
    expect(listTools).toHaveBeenCalledTimes(1)
  })

  it('returns model-visible error results for progressive MCP tool call transport failures', async () => {
    fixtures.clients.push({
      callTool: vi.fn(async () => {
        throw new Error('network down')
      }),
      listTools: vi.fn(async () => ({
        tools: [{ inputSchema: { type: 'object' }, name: 'search' }],
      })),
    })

    const plugin = mcp({
      mcpServers: {
        local: {
          command: 'node',
        },
      },
      progressiveToolDiscovery: true,
    })
    const tools = await plugin.extendTools?.(createState())

    await expect(tools?.[2]?.execute({
      arguments: {},
      name: 'mcp__local__search',
    }, {
      messages: [],
      toolCallId: 'call_1',
    })).resolves.toEqual({
      content: [{
        text: 'MCP local/search callTool failed: network down',
        type: 'text',
      }],
      isError: true,
    })
  })

  it('rejects invalid MCP tool names in progressive discovery', async () => {
    fixtures.clients.push({
      listTools: vi.fn(async () => ({
        tools: [{ inputSchema: { type: 'object' }, name: 'search' }],
      })),
    })

    const plugin = mcp({
      mcpServers: {
        docs: { command: 'node' },
      },
      progressiveToolDiscovery: true,
    })
    const tools = await plugin.extendTools?.(createState())

    await expect(tools?.[1]?.execute({ name: 'not_an_mcp_tool' }, {
      messages: [],
      toolCallId: 'call_1',
    })).rejects.toThrow('Invalid MCP tool name format: not_an_mcp_tool')

    await expect(tools?.[2]?.execute({
      arguments: {},
      name: 'bad_format',
    }, {
      messages: [],
      toolCallId: 'call_2',
    })).rejects.toThrow('Invalid MCP tool name format: bad_format')
  })

  it('keeps healthy server tools in progressive discovery when another server fails', async () => {
    fixtures.clients.push({
      listTools: vi.fn(async () => {
        throw new Error('bad list')
      }),
    }, {
      listTools: vi.fn(async () => ({
        tools: [{
          description: 'Search documentation.',
          inputSchema: { type: 'object' },
          name: 'search',
        }],
      })),
    })

    const plugin = mcp({
      mcpServers: {
        broken: {
          command: 'node',
        },
        docs: {
          command: 'node',
        },
      },
      progressiveToolDiscovery: true,
    })
    const tools = await plugin.extendTools?.(createState())
    const searchResult = await tools?.[0]?.execute({ query: 'documentation' }, {
      messages: [],
      toolCallId: 'call_1',
    })

    expect(searchResult).toEqual({
      matches: [{
        description: 'Search documentation.',
        name: 'mcp__docs__search',
        serverId: 'docs',
        toolName: 'search',
      }],
      query: 'documentation',
      serverFailures: [{
        message: 'bad list',
        serverId: 'broken',
      }],
      total: 1,
    })
  })
})
