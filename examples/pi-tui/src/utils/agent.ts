import { createAgent, responses } from '@apeira/core'
import { commonTools } from '@apeira/plugin-common-tools'
import { autoReviewByPattern, humanInTheLoop } from '@apeira/plugin-hitl'
import { skills } from '@apeira/plugin-skills'
import { fsSkillSet } from '@apeira/plugin-skills/fs'

import { apiKey, baseURL, instructions, model } from './config'

export const skillsDir = '.agents/skills'

export const skillSet = fsSkillSet({
  directory: skillsDir,
})

export const agent = createAgent({
  instructions,
  plugins: [
    humanInTheLoop({
      autoReview: autoReviewByPattern({
        always: ['bash', 'edit', 'write'],
        never: ['fetch', 'read', 'search'],
      }),
    }),
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
