const normalizeNameForMCP = (value: string) =>
  value.replace(/[^\w-]/g, '_').replace(/_{2,}/g, '_')

const getMcpPrefix = (serverId: string) =>
  `mcp__${normalizeNameForMCP(serverId)}__`

export const buildMcpToolName = (serverId: string, toolName: string) =>
  `${getMcpPrefix(serverId)}${normalizeNameForMCP(toolName)}`

export const mcpInfoFromString = (toolString: string): undefined | {
  serverName: string
  toolName: string | undefined
} => {
  const parts = toolString.split('__')
  const [mcpPart, serverName, ...toolNameParts] = parts

  if (mcpPart !== 'mcp' || !serverName)
    return

  const toolName = toolNameParts.length > 0 ? toolNameParts.join('__') : undefined
  return { serverName, toolName }
}
