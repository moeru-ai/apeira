import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { MCPConfig, MCPServerConfig, NormalizedMCPServerConfig } from '../types/plugin'

import process from 'node:process'

import { createFetchWithInit } from '@modelcontextprotocol/sdk/shared/transport.js'

const ENV_VAR_PATTERN = /\$\{([a-z_]\w*)(?::-(.*?))?\}/gi

const expandEnvVars = (value: string) =>
  value.replace(ENV_VAR_PATTERN, (_match, name: string, fallback: string | undefined) => {
    const expanded = process.env[name]

    if (expanded != null)
      return expanded

    if (fallback != null)
      return fallback

    throw new Error(`Missing environment variable in MCP config: ${name}`)
  })

const expandStringRecord = (record: Record<string, string> | undefined) => {
  if (record == null)
    return undefined

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, expandEnvVars(value)]),
  )
}

const expandStringArray = (values: string[] | undefined) =>
  values?.map(value => expandEnvVars(value))

const normalizeHTTPTransportOptions = (
  server: Extract<MCPServerConfig, { headers?: Record<string, string>, url: string }>,
): StreamableHTTPClientTransportOptions | undefined => {
  const headers = expandStringRecord(server.headers)

  if (headers == null)
    return undefined

  return {
    requestInit: { headers },
  }
}

const normalizeSSETransportOptions = (
  server: Extract<MCPServerConfig, { type: 'sse' }>,
): SSEClientTransportOptions | undefined => {
  const headers = expandStringRecord(server.headers)

  if (headers == null)
    return undefined

  return {
    eventSourceInit: {
      fetch: createFetchWithInit(undefined, { headers }),
    },
    requestInit: { headers },
  }
}

export const normalizeMCPConfig = (config: MCPConfig): Record<string, NormalizedMCPServerConfig> =>
  Object.entries(config.mcpServers).reduce<Record<string, NormalizedMCPServerConfig>>(
    (servers, [serverId, server]) => {
      const callTimeoutMs = server.timeout

      if ('command' in server) {
        servers[serverId] = {
          args: expandStringArray(server.args),
          callTimeoutMs,
          command: expandEnvVars(server.command),
          env: expandStringRecord(server.env),
          type: 'stdio',
        } satisfies NormalizedMCPServerConfig

        return servers
      }

      const url = expandEnvVars(server.url)

      if (server.type === 'sse') {
        servers[serverId] = {
          callTimeoutMs,
          transportOptions: normalizeSSETransportOptions(server),
          type: 'sse',
          url,
        } satisfies NormalizedMCPServerConfig

        return servers
      }

      servers[serverId] = {
        callTimeoutMs,
        transportOptions: normalizeHTTPTransportOptions(server),
        type: 'streamable-http',
        url,
      } satisfies NormalizedMCPServerConfig

      return servers
    },
    {},
  )
