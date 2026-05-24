import type { MCPToolCatalogFailure } from '../types/runtime'

export const toErrorMessage = (value: unknown) =>
  value instanceof Error
    ? value.message
    : String(value)

export const createErrorToolResult = (
  error: unknown,
  context: {
    operation: 'callTool' | 'connect' | 'listTools'
    serverId: string
    toolName?: string
  },
) => ({
  content: [{
    text: `MCP ${context.serverId}${context.toolName == null ? '' : `/${context.toolName}`} ${context.operation} failed: ${toErrorMessage(error)}`,
    type: 'text',
  }],
  isError: true,
})

export const createCatalogFailure = (
  serverId: string,
  error: unknown,
): MCPToolCatalogFailure => ({
  message: toErrorMessage(error),
  serverId,
})
