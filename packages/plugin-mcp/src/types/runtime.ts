import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { rawTool } from '@xsai/tool'

import type { MCPToolDefinition } from './plugin'

export interface MCPServerState {
  client?: Client
  connectPromise?: Promise<Client>
  definitions?: MCPToolDefinition[]
  failure?: MCPToolCatalogFailure
  tools?: MCPTool[]
  transport?: Transport
}

export type MCPTool = ReturnType<typeof rawTool>

export interface MCPToolCatalog {
  entries: MCPToolCatalogEntry[]
  entriesByName: Map<string, MCPToolCatalogEntry>
  failures: MCPToolCatalogFailure[]
}

export interface MCPToolCatalogEntry {
  definition: MCPToolDefinition
  name: string
  serverId: string
  toolName: string
}

export interface MCPToolCatalogFailure {
  message: string
  serverId: string
}
