import { createAgent } from '@apeira/core'
import { createSkillsRegistry, skills } from '@apeira/plugin-skills'

import { agentName, apiKey, baseURL, instructions, model } from './config'
import { loadWorkspaceSkillReference, loadWorkspaceSkills } from './skills'
import { bashTool, editFileTool, listFilesTool, readFileTool, writeFileTool } from './tools'

export const skillsRegistry = createSkillsRegistry({
  loadSkillReference: loadWorkspaceSkillReference,
  loadSkills: loadWorkspaceSkills,
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
      registry: skillsRegistry,
    }),
  ],
})
