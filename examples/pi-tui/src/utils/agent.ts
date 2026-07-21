import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { commonTools } from '@apeira/plugin-common-tools'
import { hitl, toolPolicy } from '@apeira/plugin-hitl'
import { skills } from '@apeira/plugin-skills'
import { fsSkillSet } from '@apeira/plugin-skills/fs'

import { apiKey, baseURL, instructions, model } from './config'

export const skillsDir = '.agents/skills'

export const skillSet = fsSkillSet({
  directory: skillsDir,
})

export const approval = hitl({
  policies: [toolPolicy({
    allow: ['fetch', 'read', 'search'],
  })],
})

export const agent = createAgent({
  instructions,
  plugins: [
    approval,
    commonTools(),
    skills({
      refresh: 'turn',
      sets: [skillSet],
    }),
  ],
  runner: responses({
    apiKey,
    baseURL,
    model,
  }),
})
