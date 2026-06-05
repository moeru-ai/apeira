import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

import type { NormalizedMCPServerConfig } from '../types/plugin'
import type { MCPTool, MCPToolCatalog } from '../types/runtime'

import { rawTool } from '@xsai/tool'

import { getRequestOptions } from './client'
import { mcpInfoFromString } from './names'
import { createErrorToolResult } from './result'

export interface CreateProgressiveMCPToolsOptions {
  getConnectedClient: (serverId: string) => Promise<Client>
  listToolCatalog: () => Promise<MCPToolCatalog>
  servers: Record<string, NormalizedMCPServerConfig>
}

const findCatalogEntry = (catalog: MCPToolCatalog, name: string) =>
  catalog.entriesByName.get(name)

export const createProgressiveMCPTools = (
  options: CreateProgressiveMCPToolsOptions,
): MCPTool[] => {
  let catalogPromise: Promise<MCPToolCatalog> | undefined

  const getCatalog = async () => {
    catalogPromise ??= options.listToolCatalog()
    return catalogPromise
  }

  return [
    rawTool({
      description: 'Search available MCP tools by name, server, and description. Returns concise matches only; use get_mcp_tool_details before calling a tool.',
      execute: async (input, _executeOptions) => {
        const { limit = 10, query = '' } = input as { limit?: number, query?: string }
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
        const catalog = await getCatalog()
        const matches = catalog.entries
          .map((entry) => {
            const haystack = [
              entry.name,
              entry.serverId,
              entry.toolName,
              entry.definition.description ?? '',
            ].join(' ').toLowerCase()
            const score = terms.length === 0
              ? 1
              : terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0)

            return { entry, score }
          })
          .filter(match => match.score > 0)
          .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
          .slice(0, limit)
          .map(({ entry }) => ({
            description: entry.definition.description,
            name: entry.name,
            serverId: entry.serverId,
            toolName: entry.toolName,
          }))

        return {
          matches,
          query,
          serverFailures: catalog.failures,
          total: catalog.entries.length,
        }
      },
      name: 'search_mcp_tools',
      parameters: {
        additionalProperties: false,
        properties: {
          limit: {
            default: 10,
            description: 'Maximum number of matches to return.',
            minimum: 1,
            type: 'number',
          },
          query: {
            description: 'Natural language keywords, server name, or tool name to search for.',
            type: 'string',
          },
        },
        required: ['query'],
        type: 'object',
      },
    }),
    rawTool({
      description: 'Get the full schema and description for one MCP tool returned by search_mcp_tools.',
      execute: async (input, _executeOptions) => {
        const { name } = input as { name: string }
        const info = mcpInfoFromString(name)

        if (info == null)
          throw new Error(`Invalid MCP tool name format: ${name}`)

        const catalog = await getCatalog()
        const entry = findCatalogEntry(catalog, name)

        if (entry == null)
          throw new Error(`Unknown MCP tool: ${name}`)

        return {
          description: entry.definition.description,
          inputSchema: entry.definition.inputSchema,
          name: entry.name,
          serverId: entry.serverId,
          toolName: entry.toolName,
        }
      },
      name: 'get_mcp_tool_details',
      parameters: {
        additionalProperties: false,
        properties: {
          name: {
            description: 'The MCP tool name returned by search_mcp_tools.',
            type: 'string',
          },
        },
        required: ['name'],
        type: 'object',
      },
    }),
    rawTool({
      description: 'Call one MCP tool by name after inspecting it with get_mcp_tool_details.',
      execute: async (input, _executeOptions) => {
        const { arguments: toolArguments = {}, name } = input as { arguments?: Record<string, unknown>, name: string }
        const info = mcpInfoFromString(name)

        if (info == null)
          throw new Error(`Invalid MCP tool name format: ${name}`)

        const catalog = await getCatalog()
        const entry = findCatalogEntry(catalog, name)

        if (entry == null)
          throw new Error(`Unknown MCP tool: ${name}`)

        const client = await options.getConnectedClient(entry.serverId)
        const serverConfig = options.servers[entry.serverId]

        if (serverConfig == null)
          throw new Error(`Unknown MCP server: ${entry.serverId}`)

        try {
          return await client.callTool(
            {
              arguments: toolArguments,
              name: entry.toolName,
            },
            undefined,
            getRequestOptions(serverConfig),
          )
        }
        catch (error) {
          return createErrorToolResult(error, {
            operation: 'callTool',
            serverId: entry.serverId,
            toolName: entry.toolName,
          })
        }
      },
      name: 'call_mcp_tool',
      parameters: {
        additionalProperties: false,
        properties: {
          arguments: {
            additionalProperties: true,
            description: 'Arguments matching the tool inputSchema returned by get_mcp_tool_details.',
            type: 'object',
          },
          name: {
            description: 'The MCP tool name returned by search_mcp_tools.',
            type: 'string',
          },
        },
        required: ['name', 'arguments'],
        type: 'object',
      },
    }),
  ]
}
