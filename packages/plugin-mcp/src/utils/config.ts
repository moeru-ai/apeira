import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import type { MCPConfig, MCPServerConfig, NormalizedMCPServerConfig } from '../types/plugin'

import { env } from 'node:process'

import { createFetchWithInit } from '@modelcontextprotocol/sdk/shared/transport.js'

const ENV_VAR_PATTERN = /\$\{([^}]+)\}/g

const expandEnvVars = (value: string, missingVars: Set<string>) =>
  value.replace(ENV_VAR_PATTERN, (match, expression: string) => {
    const fallbackSeparator = expression.indexOf(':-')
    const name = fallbackSeparator === -1
      ? expression
      : expression.slice(0, fallbackSeparator)
    const fallback = fallbackSeparator === -1
      ? undefined
      : expression.slice(fallbackSeparator + 2)
    const expanded = env[name]

    if (expanded !== undefined)
      return expanded

    if (fallback !== undefined)
      return fallback

    missingVars.add(name)
    return match
  })

const expandStringRecord = (record: Record<string, string> | undefined, missingVars: Set<string>) => {
  if (record == null)
    return undefined

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, expandEnvVars(value, missingVars)]),
  )
}

const expandStringArray = (values: string[] | undefined, missingVars: Set<string>) =>
  values?.map(value => expandEnvVars(value, missingVars))

const normalizeHTTPTransportOptions = (
  server: Extract<MCPServerConfig, { type: 'http' | 'streamable-http' }>,
  missingVars: Set<string>,
): StreamableHTTPClientTransportOptions | undefined => {
  const headers = expandStringRecord(server.headers, missingVars)

  if (headers == null)
    return undefined

  return {
    requestInit: { headers },
  }
}

const normalizeSSETransportOptions = (
  server: Extract<MCPServerConfig, { type: 'sse' }>,
  missingVars: Set<string>,
): SSEClientTransportOptions | undefined => {
  const headers = expandStringRecord(server.headers, missingVars)

  if (headers == null)
    return undefined

  return {
    eventSourceInit: {
      fetch: createFetchWithInit(undefined, { headers }),
    },
    requestInit: { headers },
  }
}

export const normalizeMCPConfig = (config: MCPConfig): Record<string, NormalizedMCPServerConfig> => {
  const missingVars = new Set<string>()
  const servers = Object.entries(config.mcpServers).reduce<Record<string, NormalizedMCPServerConfig>>(
    (servers, [serverId, server]) => {
      const callTimeoutMs = server.timeout

      if ('command' in server) {
        servers[serverId] = {
          args: expandStringArray(server.args, missingVars) ?? [],
          callTimeoutMs,
          command: expandEnvVars(server.command, missingVars),
          env: expandStringRecord(server.env, missingVars),
          type: 'stdio',
        } satisfies NormalizedMCPServerConfig

        return servers
      }

      const url = expandEnvVars(server.url, missingVars)

      if (server.type === 'sse') {
        servers[serverId] = {
          callTimeoutMs,
          transportOptions: normalizeSSETransportOptions(server, missingVars),
          type: 'sse',
          url,
        } satisfies NormalizedMCPServerConfig

        return servers
      }

      if (server.type === 'ws') {
        servers[serverId] = {
          callTimeoutMs,
          type: 'ws',
          url,
        } satisfies NormalizedMCPServerConfig

        return servers
      }

      servers[serverId] = {
        callTimeoutMs,
        transportOptions: normalizeHTTPTransportOptions(server, missingVars),
        type: 'streamable-http',
        url,
      } satisfies NormalizedMCPServerConfig

      return servers
    },
    {},
  )

  if (missingVars.size > 0)
    throw new Error(`Missing environment variables in MCP config: ${[...missingVars].join(', ')}`)

  return servers
}
