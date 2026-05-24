import type { AgentPlugin } from '@apeira/core'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import type { MCPConfig } from './types/plugin'
import type { MCPServerState, MCPTool } from './types/runtime'

import { rawTool } from '@xsai/tool'

import { name, version } from '../package.json'
import { createMCPClient, createMCPTransport, getRequestOptions } from './utils/client'
import { normalizeMCPConfig } from './utils/config'
import { defaultNameMapper } from './utils/names'

export type {
  MCPConfig,
  MCPHttpServerConfig,
  MCPServerConfig,
  MCPServerConfigBase,
  MCPSseServerConfig,
  MCPStdioServerConfig,
  MCPToolDefinition,
  MCPToolResult,
} from './types/plugin'

export const mcp = (config: MCPConfig): AgentPlugin => {
  const servers = normalizeMCPConfig(config)

  const states = new Map<string, MCPServerState>()
  for (const serverId of Object.keys(servers))
    states.set(serverId, {})

  const getConnectedClient = async (serverId: string, signal?: AbortSignal) => {
    const config = servers[serverId]
    const state = states.get(serverId)

    if (config == null || state == null)
      throw new Error(`Unknown MCP server: ${serverId}`)

    if (state.client != null)
      return state.client

    if (state.connectPromise != null)
      return state.connectPromise

    state.connectPromise = (async () => {
      try {
        const client = createMCPClient({
          version,
        })
        const transport = await createMCPTransport(config)

        await client.connect(transport, getRequestOptions(config, signal))

        state.client = client
        state.transport = transport

        return client
      }
      catch (error) {
        state.connectPromise = undefined
        throw error
      }
    })()

    return state.connectPromise
  }

  const listServerTools = async (serverId: string, signal?: AbortSignal): Promise<MCPTool[]> => {
    const config = servers[serverId]
    const state = states.get(serverId)

    if (config == null || state == null)
      throw new Error(`Unknown MCP server: ${serverId}`)

    if (state.tools != null)
      return state.tools

    const client: Client = await getConnectedClient(serverId, signal)

    const listed = await client.listTools(undefined, getRequestOptions(config, signal))
    const tools: MCPTool[] = []

    for (const mcpTool of listed.tools) {
      const localToolName = defaultNameMapper(serverId, mcpTool.name)

      tools.push(rawTool({
        description: mcpTool.description,
        execute: async (input, executeOptions) => client.callTool(
          {
            arguments: input as Record<string, unknown>,
            name: mcpTool.name,
          },
          undefined,
          getRequestOptions(config, executeOptions.abortSignal),
        ),
        name: localToolName,
        parameters: mcpTool.inputSchema,
      }))
    }

    state.tools = tools
    return tools
  }

  return {
    name,
    resolveTools: async ({ signal }) => {
      const toolGroups = await Promise.all([...states.keys()].map(async serverId => listServerTools(serverId, signal)))
      return toolGroups.flat()
    },
    version,
  }
}
