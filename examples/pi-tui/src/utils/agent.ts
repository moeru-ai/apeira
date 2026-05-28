import { createAgent } from '@apeira/core'
import { commonTools } from '@apeira/plugin-common-tools'
import { hitl } from '@apeira/plugin-hitl'
import { skills } from '@apeira/plugin-skills'
import { fsSkillSet } from '@apeira/plugin-skills/fs'

import { createHitlDemoTools, createHitlReplayFetch, isHitlDemoEnabled } from '../../../shared/hitl-demo'
import { agentName, apiKey, baseURL, instructions, model } from './config'

export const skillsDir = '.agents/skills'

export const skillSet = fsSkillSet({
  directory: skillsDir,
})

export const hitlControl = hitl({
  mode: 'ask',
  scope: 'conversation',
})

export const hitlDemoEnabled = isHitlDemoEnabled()

export const hitlDemoReplay = createHitlReplayFetch({
  toolName: 'bash',
})

export const agent = createAgent({
  instructions: hitlDemoEnabled
    ? `${instructions}\n\nYou are running in HITL demo mode. Use tool calls normally; tools are simulated.`
    : instructions,
  name: agentName,
  options: {
    apiKey: hitlDemoEnabled ? 'hitl-demo' : apiKey,
    baseURL: hitlDemoEnabled ? 'https://hitl-demo.invalid/v1/' : baseURL,
    fetch: hitlDemoEnabled ? hitlDemoReplay.fetch : undefined,
    model: hitlDemoEnabled ? 'hitl-demo-replay' : model,
    tools: hitlDemoEnabled ? createHitlDemoTools() : undefined,
  },
  plugins: [
    hitlControl.plugin,
    hitlDemoEnabled ? false : commonTools(),
    skills({
      refresh: 'turn',
      sets: [skillSet],
    }),
  ],
})
