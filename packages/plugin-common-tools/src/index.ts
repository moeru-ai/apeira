import type { AgentPlugin, rawTool } from '@apeira/core'

import { name, version } from '../package.json'
import { createBashTool } from './tools/bash'
import { createEditTool } from './tools/edit'
import { createFetchTool } from './tools/fetch'
import { createReadTool } from './tools/read'
import { createSearchTool } from './tools/search'
import { createWriteTool } from './tools/write'

export type CommonToolsPluginOptions = {
  exclude: string[]
  include?: never
} | {
  exclude?: never
  include: string[]
} | {
  exclude?: never
  include?: never
}

type Tool = ReturnType<typeof rawTool>

const TOOL_FACTORIES: Array<{ factory: () => Promise<Tool> | Tool, name: string }> = [
  { factory: createReadTool, name: 'read' },
  { factory: createWriteTool, name: 'write' },
  { factory: createEditTool, name: 'edit' },
  { factory: createBashTool, name: 'bash' },
  { factory: createFetchTool, name: 'fetch' },
  { factory: createSearchTool, name: 'search' },
]

export const commonTools = (options: CommonToolsPluginOptions = {}): AgentPlugin => ({
  extendTools: async () => {
    const picks = new Set(options.include)
    const skips = new Set(options.exclude ?? [])
    const hasInclude = options.include != null

    return Promise.all(TOOL_FACTORIES.filter(({ name }) => {
      if (skips.has(name))
        return false
      if (hasInclude && !picks.has(name))
        return false
      return true
    }).map(async ({ factory }) => factory()))
  },
  name,
  version,
})
