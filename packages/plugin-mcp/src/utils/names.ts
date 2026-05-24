const sanitizeToolNamePart = (value: string) =>
  value.replace(/[^\w-]/g, '_')

export const defaultNameMapper = (serverId: string, toolName: string) =>
  `mcp_${sanitizeToolNamePart(serverId)}__${sanitizeToolNamePart(toolName)}`
