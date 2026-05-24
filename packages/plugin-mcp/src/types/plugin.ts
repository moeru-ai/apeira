import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { SSEClientTransportOptions } from '@modelcontextprotocol/sdk/client/sse.js'
import type { StdioServerParameters } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { StreamableHTTPClientTransportOptions } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
  /**
   * @see {@link https://modelcontextprotocol.io/docs/develop/clients/client-best-practices#progressive-tool-discovery}
   * @default false
   */
  progressiveToolDiscovery?: boolean
}

export interface MCPHttpServerConfig extends MCPServerConfigBase {
  headers?: Record<string, string>
  type: 'http' | 'streamable-http'
  url: string
}

export type MCPServerConfig
  = | MCPHttpServerConfig
    | MCPSseServerConfig
    | MCPStdioServerConfig

export interface MCPServerConfigBase {
  timeout?: number
}

export interface MCPSseServerConfig extends MCPServerConfigBase {
  headers?: Record<string, string>
  type: 'sse'
  url: string
}

export interface MCPStdioServerConfig extends MCPServerConfigBase {
  args?: string[]
  command: string
  env?: Record<string, string>
  type?: 'stdio'
}

export type MCPToolDefinition = Awaited<ReturnType<Client['listTools']>>['tools'][number]

export type MCPToolResult = Awaited<ReturnType<Client['callTool']>>

export type NormalizedMCPServerConfig
  = | NormalizedMCPSseServerConfig
    | NormalizedMCPStdioServerConfig
    | NormalizedMCPStreamableHTTPServerConfig

export interface NormalizedMCPServerConfigBase {
  callTimeoutMs?: number
}

export interface NormalizedMCPSseServerConfig extends NormalizedMCPServerConfigBase {
  transportOptions?: SSEClientTransportOptions
  type: 'sse'
  url: string | URL
}

export interface NormalizedMCPStdioServerConfig extends NormalizedMCPServerConfigBase, StdioServerParameters {
  type: 'stdio'
}

export interface NormalizedMCPStreamableHTTPServerConfig extends NormalizedMCPServerConfigBase {
  transportOptions?: StreamableHTTPClientTransportOptions
  type: 'streamable-http'
  url: string | URL
}
