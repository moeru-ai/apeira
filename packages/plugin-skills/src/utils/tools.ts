import type { SkillSet } from '../types'

import { tool } from '@apeira/core'
import { z } from 'zod'

import { formatSkillInvocation, formatSkillReference } from './format'

const skillToolInputSchema = z.object({
  additionalInstructions: z.string().optional().describe('Optional task-specific instructions to append after the skill content.'),
  name: z.string().describe('Skill name from the available_skills list.'),
})

const skillReferenceToolInputSchema = z.object({
  name: z.string().describe('Skill name from the available_skills list.'),
  path: z.string().describe('Reference path from the selected skill reference manifest.'),
})

export const createSkillTool = async (skillSet: SkillSet, toolName: string) => tool({
  description: 'Load the full instructions for an available skill by name. Use this before answering when a user request matches a listed skill.',
  execute: (input: unknown) => {
    const args = z.parse(skillToolInputSchema, input)
    const skill = skillSet.getSkill(args.name)

    if (skill == null)
      throw new Error(`Unknown skill: ${args.name}`)

    return formatSkillInvocation(skill, args.additionalInstructions)
  },
  name: toolName,
  parameters: skillToolInputSchema,
})

export const createSkillReferenceTool = async (skillSet: SkillSet, toolName: string) => tool({
  description: 'Load a referenced file for a previously selected skill. Use only paths listed by the skill tool.',
  execute: async (input: unknown) => {
    const args = z.parse(skillReferenceToolInputSchema, input)
    const skill = skillSet.getSkill(args.name)

    if (skill == null)
      throw new Error(`Unknown skill reference: ${args.name}/${args.path}`)

    const reference = await skillSet.getSkillReference(args.name, args.path)

    if (reference == null || reference.content == null)
      throw new Error(`Unknown skill reference: ${args.name}/${args.path}`)

    return formatSkillReference(skill, { ...reference, content: reference.content })
  },
  name: toolName,
  parameters: skillReferenceToolInputSchema,
})
