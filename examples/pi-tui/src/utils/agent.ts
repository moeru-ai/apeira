import { createAgent } from '@apeira/core'
import { skills } from '@apeira/plugin-skills'
import { fsSkillSet } from '@apeira/plugin-skills/fs'

import { agentName, apiKey, baseURL, instructions, model, workspaceRoot } from './config'
import { bashTool, editFileTool, listFilesTool, readFileTool, writeFileTool } from './tools'
import path from 'node:path'

export const skillsDir = path.join(workspaceRoot, '.agents', 'skills')

export const skillSet = fsSkillSet({
  directory: skillsDir,
})

export const agent = createAgent({
  instructions,
  name: agentName,
  options: {
    apiKey,
    baseURL,
    model,
    tools: [listFilesTool, readFileTool, writeFileTool, editFileTool, bashTool],
  },
  plugins: [
    skills({
      refresh: 'turn',
      sets: [skillSet],
    }),
  ],
})
