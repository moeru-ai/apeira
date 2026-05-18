import { createAgent } from '@apeira/core'

import { agentName, apiKey, baseURL, instructions, model } from './config'
import { editFileTool, listFilesTool, readFileTool, writeFileTool } from './tools'

export const agent = createAgent({
  instructions,
  name: agentName,
  options: {
    apiKey,
    baseURL,
    model,
    tools: [listFilesTool, readFileTool, writeFileTool, editFileTool],
  },
})
