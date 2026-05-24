import type { RequestOptions } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import type { NormalizedMCPServerConfig } from '../types/plugin'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
// eslint-disable-next-line sonarjs/deprecation
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js'

const DEFAULT_CLIENT_NAME = 'apeira-mcp-client'

const toUrl = (value: string | URL) =>
  value instanceof URL ? value : new URL(value)

export const createMCPTransport = async (config: NormalizedMCPServerConfig): Promise<Transport> => {
  switch (config.type) {
    case 'sse':
      // eslint-disable-next-line sonarjs/deprecation
      return new SSEClientTransport(toUrl(config.url), config.transportOptions)
    case 'stdio':
      return new StdioClientTransport({
        args: config.args,
        command: config.command,
        cwd: config.cwd,
        env: config.env,
        stderr: config.stderr,
      })
    case 'streamable-http':
      return new StreamableHTTPClientTransport(toUrl(config.url), config.transportOptions)
    case 'ws':
      return new WebSocketClientTransport(toUrl(config.url))
  }
}

export const createMCPClient = (
  options: {
    version: string
  },
) => new Client(
  {
    name: DEFAULT_CLIENT_NAME,
    version: options.version,
  },
)

export const getRequestOptions = (
  config: NormalizedMCPServerConfig,
  signal?: AbortSignal,
): RequestOptions => ({
  signal,
  timeout: config.callTimeoutMs,
})
