import type { AgentPlugin } from '@apeira/core'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import type { MCPConfig, MCPToolDefinition } from './types/plugin'
import type { MCPServerState, MCPTool, MCPToolCatalog } from './types/runtime'

import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { rawTool } from '@xsai/tool'

import { name, version } from '../package.json'
import { createMCPClient, createMCPTransport, getRequestOptions } from './utils/client'
import { normalizeMCPConfig } from './utils/config'
import { buildMcpToolName } from './utils/names'
import { createProgressiveMCPTools } from './utils/progressive'
import { createCatalogFailure, createErrorToolResult } from './utils/result'

const MAX_MCP_DESCRIPTION_LENGTH = 2048

export type {
  MCPConfig,
  MCPHttpServerConfig,
  MCPServerConfig,
  MCPServerConfigBase,
  MCPSseServerConfig,
  MCPStdioServerConfig,
  MCPToolDefinition,
  MCPToolResult,
  MCPWebSocketServerConfig,
} from './types/plugin'

export const mcp = (config: MCPConfig): AgentPlugin => {
  const servers = normalizeMCPConfig(config)
  let catalog: MCPToolCatalog | undefined

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

        client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
          state.definitions = undefined
          state.tools = undefined
          catalog = undefined
        })

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

  const listServerToolDefinitions = async (serverId: string, signal?: AbortSignal): Promise<MCPToolDefinition[]> => {
    const config = servers[serverId]
    const state = states.get(serverId)

    if (config == null || state == null)
      throw new Error(`Unknown MCP server: ${serverId}`)

    if (state.definitions != null)
      return state.definitions

    const client: Client = await getConnectedClient(serverId, signal)

    const definitions: MCPToolDefinition[] = []
    let cursor: string | undefined

    do {
      const listed = await client.listTools(
        cursor == null ? undefined : { cursor },
        getRequestOptions(config, signal),
      )

      definitions.push(...listed.tools)
      cursor = listed.nextCursor
    } while (cursor != null)

    state.definitions = definitions.map(d => ({
      ...d,
      description: d.description != null
        ? d.description.slice(0, MAX_MCP_DESCRIPTION_LENGTH)
        : d.description,
    }))
    state.failure = undefined
    catalog = undefined
    return state.definitions
  }

  const listToolCatalog = async (signal?: AbortSignal): Promise<MCPToolCatalog> => {
    if (catalog != null)
      return catalog

    const results = await Promise.allSettled([...states.keys()].map(async (serverId) => {
      const definitions = await listServerToolDefinitions(serverId, signal)

      return definitions.map(definition => ({
        definition,
        name: buildMcpToolName(serverId, definition.name),
        serverId,
        toolName: definition.name,
      }))
    }))

    if (signal?.aborted)
      throw signal.reason ?? new Error('MCP tool resolution aborted.')

    const entries = results.flatMap((result, index) => {
      const serverId = [...states.keys()][index]
      const state = serverId == null ? undefined : states.get(serverId)

      if (result.status === 'fulfilled') {
        if (state != null)
          state.failure = undefined

        return result.value
      }

      if (serverId != null && state != null)
        state.failure = createCatalogFailure(serverId, result.reason)

      return []
    })
    const entriesByName = new Map(entries.map(entry => [entry.name, entry]))
    const failures = [...states.values()]
      .map(state => state.failure)
      .filter((failure): failure is NonNullable<typeof failure> => failure != null)

    catalog = { entries, entriesByName, failures }
    return catalog
  }

  const listServerTools = async (serverId: string, signal?: AbortSignal): Promise<MCPTool[]> => {
    const serverConfig = servers[serverId]
    const state = states.get(serverId)

    if (serverConfig == null || state == null)
      throw new Error(`Unknown MCP server: ${serverId}`)

    if (state.tools != null)
      return state.tools

    const definitions = await listServerToolDefinitions(serverId, signal)
    const client: Client = await getConnectedClient(serverId, signal)
    const tools: MCPTool[] = []

    for (const mcpTool of definitions) {
      const localToolName = buildMcpToolName(serverId, mcpTool.name)

      tools.push(rawTool({
        description: mcpTool.description,
        execute: async (input, executeOptions) => {
          try {
            return await client.callTool(
              {
                arguments: input as Record<string, unknown>,
                name: mcpTool.name,
              },
              undefined,
              getRequestOptions(serverConfig, executeOptions.abortSignal),
            )
          }
          catch (error) {
            return createErrorToolResult(error, {
              operation: 'callTool',
              serverId,
              toolName: mcpTool.name,
            })
          }
        },
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
      if (config.progressiveToolDiscovery === true) {
        return createProgressiveMCPTools({
          getConnectedClient,
          listToolCatalog,
          servers,
        })
      }

      const serverIds = [...states.keys()]
      const results = await Promise.allSettled(serverIds.map(async serverId => listServerTools(serverId, signal)))

      if (signal.aborted)
        throw signal.reason ?? new Error('MCP tool resolution aborted.')

      results.forEach((result, index) => {
        const serverId = serverIds[index]
        const state = serverId == null ? undefined : states.get(serverId)

        if (state == null)
          return

        state.failure = result.status === 'rejected'
          ? createCatalogFailure(serverId, result.reason)
          : undefined
      })

      return results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    },
    version,
  }
}
