import type { AgentPlugin, MaybePromise } from '@apeira/core'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { name, version } from '../package.json'

export interface Skill {
  content: string
  description: string
  filePath: string
  name: string
  references?: SkillReference[]
}

export interface SkillDiagnostic {
  code: string
  message: string
  path?: string
  type: 'warning'
}

export interface SkillReference {
  content?: string
  description?: string
  path: string
}

export type SkillReferenceLoader = (skill: Skill, path: string) => MaybePromise<SkillReference | string | undefined>
export interface SkillSet {
  getDiagnostics: () => SkillDiagnostic[]
  getSkill: (name: string) => Skill | undefined
  getSkillReference: (skillName: string, referencePath: string) => Promise<SkillReference | undefined>
  getSkills: () => Skill[]
  priority?: number
  refresh: () => Promise<SkillSetSnapshot>
}

export interface SkillSetOptions {
  diagnostics?: SkillDiagnostic[]
  loadSkillReference?: SkillReferenceLoader
  loadSkills?: () => MaybePromise<Skill[] | SkillSetSnapshot>
  priority?: number
  skills?: Skill[]
}

export interface SkillSetSnapshot {
  diagnostics: SkillDiagnostic[]
  skills: Skill[]
}

export interface SkillsPluginOptions {
  referenceToolName?: string
  /**
   * Reload skills before each turn. Useful when using filesystem-backed skill sets
   * so edits to skill files appear without restarting the agent.
   */
  refresh?: 'manual' | 'turn'
  /** Skill sets to merge. Skills are deduplicated by name (higher `priority` wins). */
  sets?: SkillSet[]
  /** Static skills (convenience for trivial cases — no refresh, no priority). */
  skills?: Skill[]
  toolName?: string
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const trimTrailingSlashes = (value: string) => {
  let endIndex = value.length

  while (endIndex > 0 && value[endIndex - 1] === '/')
    endIndex -= 1

  return value.slice(0, endIndex)
}

const dirnamePath = (path: string) => {
  const normalized = trimTrailingSlashes(path)
  const slashIndex = normalized.lastIndexOf('/')

  return slashIndex <= 0 ? '/' : normalized.slice(0, slashIndex)
}

const normalizeSnapshot = (value: Skill[] | SkillSetSnapshot): SkillSetSnapshot =>
  Array.isArray(value)
    ? { diagnostics: [], skills: value }
    : {
        diagnostics: value.diagnostics.slice(),
        skills: value.skills.slice(),
      }

const formatReferenceManifest = (references: readonly SkillReference[]) =>
  references.map((reference) => {
    const description = reference.description == null || reference.description.trim().length === 0
      ? ''
      : `: ${reference.description.trim()}`

    return `- ${reference.path}${description}`
  })

const formatSkillReference = (skill: Skill, reference: SkillReference & { content: string }) => [
  `<skill_reference skill="${escapeXml(skill.name)}" path="${escapeXml(reference.path)}">`,
  reference.content,
  '</skill_reference>',
].join('\n')

export const formatSkillsForSystemPrompt = (skills: readonly Skill[]): string => {
  if (skills.length === 0)
    return ''

  const lines = [
    'The following skills provide specialized instructions for specific tasks.',
    'When the task matches a skill description, call the skill tool with that skill name before answering.',
    'Do not read skill files directly when the skill tool is available.',
    '',
    '<available_skills>',
  ]

  for (const skill of skills) {
    lines.push('  <skill>')
    lines.push(`    <name>${escapeXml(skill.name)}</name>`)
    lines.push(`    <description>${escapeXml(skill.description)}</description>`)
    lines.push(`    <location>${escapeXml(skill.filePath)}</location>`)
    lines.push('  </skill>')
  }

  lines.push('</available_skills>')
  return lines.join('\n')
}

export const formatSkillInvocation = (skill: Skill, additionalInstructions?: string): string => {
  const referenceLines = formatReferenceManifest(skill.references ?? [])
  const skillBlock = [
    `<skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`,
    `References are relative to ${escapeXml(dirnamePath(skill.filePath))}.`,
    ...(referenceLines.length > 0
      ? [
          '',
          'Available references. Call the skill_reference tool with this skill name and one of these paths when you need the referenced material.',
          ...referenceLines,
        ]
      : []),
    '',
    skill.content,
    '</skill>',
  ].join('\n')

  return additionalInstructions == null || additionalInstructions.trim().length === 0
    ? skillBlock
    : `${skillBlock}\n\n${additionalInstructions.trim()}`
}

export const createSkillSet = (options: SkillSetOptions = {}): SkillSet => {
  let snapshot: SkillSetSnapshot = {
    diagnostics: options.diagnostics?.slice() ?? [],
    skills: options.skills?.slice() ?? [],
  }

  const refresh = async () => {
    if (options.loadSkills != null)
      snapshot = normalizeSnapshot(await options.loadSkills())

    return {
      diagnostics: snapshot.diagnostics.slice(),
      skills: snapshot.skills.slice(),
    }
  }

  const getSkillReference = async (skillName: string, referencePath: string) => {
    const skill = snapshot.skills.find(candidate => candidate.name === skillName)
    const reference = skill?.references?.find(candidate => candidate.path === referencePath)

    if (skill == null || reference == null)
      return undefined

    if (reference.content != null)
      return reference

    const loaded = await options.loadSkillReference?.(skill, referencePath)

    if (loaded == null)
      return undefined

    return typeof loaded === 'string'
      ? { ...reference, content: loaded }
      : {
          ...reference,
          ...loaded,
          path: referencePath,
        }
  }

  return {
    getDiagnostics: () => snapshot.diagnostics.slice(),
    getSkill: skillName => snapshot.skills.find(skill => skill.name === skillName),
    getSkillReference,
    getSkills: () => snapshot.skills.slice(),
    priority: options.priority,
    refresh,
  }
}

const skillToolInputSchema = z.object({
  additionalInstructions: z.string().optional().describe('Optional task-specific instructions to append after the skill content.'),
  name: z.string().describe('Skill name from the available_skills list.'),
})

const skillReferenceToolInputSchema = z.object({
  name: z.string().describe('Skill name from the available_skills list.'),
  path: z.string().describe('Reference path from the selected skill reference manifest.'),
})

const createSkillTool = async (skillSet: SkillSet, toolName: string) => tool({
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

const createSkillReferenceTool = async (skillSet: SkillSet, toolName: string) => tool({
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

const mergeSkillSets = (sets: SkillSet[]): SkillSet => {
  const sorted = [...sets].sort((left, right) => {
    const lp = left.priority ?? 0
    const rp = right.priority ?? 0

    return rp - lp
  })

  const refresh = async () => {
    const allDiagnostics: SkillDiagnostic[] = []
    const allSkills: Skill[] = []
    const seenNames = new Set<string>()

    for (const skillSet of sorted) {
      const snapshot = await skillSet.refresh()

      for (const skill of snapshot.skills) {
        if (!seenNames.has(skill.name)) {
          seenNames.add(skill.name)
          allSkills.push(skill)
        }
      }

      allDiagnostics.push(...snapshot.diagnostics)
    }

    return { diagnostics: allDiagnostics, skills: allSkills }
  }

  const findSkillSet = (skillName: string) =>
    sorted.find(skillSet => skillSet.getSkill(skillName) != null)

  return {
    getDiagnostics: () => sorted.flatMap(skillSet => skillSet.getDiagnostics()),
    getSkill: (skillName) => {
      for (const skillSet of sorted) {
        const skill = skillSet.getSkill(skillName)
        if (skill != null)
          return skill
      }
    },
    getSkillReference: async (skillName, referencePath) => {
      const skillSet = findSkillSet(skillName)
      return skillSet != null
        ? skillSet.getSkillReference(skillName, referencePath)
        : undefined
    },
    getSkills: () => {
      const seenNames = new Set<string>()
      return sorted.flatMap(skillSet =>
        skillSet.getSkills().filter((skill) => {
          if (seenNames.has(skill.name))
            return false
          seenNames.add(skill.name)
          return true
        }),
      )
    },
    refresh,
  }
}

export const skills = (options: SkillsPluginOptions = {}): AgentPlugin => {
  const skillSet = options.sets != null && options.sets.length > 0
    ? mergeSkillSets(options.sets)
    : options.skills != null
      ? createSkillSet({ skills: options.skills })
      : createSkillSet()

  const refreshMode = options.refresh ?? (options.sets != null ? 'turn' : 'manual')

  const referenceToolName = options.referenceToolName ?? 'skill_reference'
  const toolName = options.toolName ?? 'skill'

  return {
    extendInstructions: () => {
      const prompt = formatSkillsForSystemPrompt(skillSet.getSkills())

      return prompt.length > 0 ? prompt : undefined
    },
    name,
    onTurnStart: async () => {
      if (refreshMode !== 'turn')
        return

      await skillSet.refresh()
    },
    resolveTools: async () => {
      const skillsList = skillSet.getSkills()

      if (skillsList.length === 0)
        return undefined

      const tools = [await createSkillTool(skillSet, toolName)]

      if (skillsList.some(skill => skill.references != null && skill.references.length > 0))
        tools.push(await createSkillReferenceTool(skillSet, referenceToolName))

      return tools
    },
    version,
  }
}
