import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { rawTool } from '@xsai/tool'

import type { MCPToolDefinition } from './plugin'

export interface MCPServerState {
  client?: Client
  connectPromise?: Promise<Client>
  definitions?: MCPToolDefinition[]
  tools?: MCPTool[]
  transport?: Transport
}

export type MCPTool = ReturnType<typeof rawTool>

export interface MCPToolCatalogEntry {
  definition: MCPToolDefinition
  name: string
  serverId: string
  toolName: string
}
