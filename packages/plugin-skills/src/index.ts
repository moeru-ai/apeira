import type { AgentPlugin, ItemParam } from '@apeira/core'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { name, version } from '../package.json'

export interface Skill {
  content: string
  description: string
  disableModelInvocation?: boolean
  filePath: string
  name: string
}

export interface SkillDiagnostic {
  code: string
  message: string
  path?: string
  type: 'warning'
}

export type SkillsLoader = () => MaybePromise<Skill[] | SkillsRegistrySnapshot>

export interface SkillsPluginOptions extends SkillsRegistryOptions {
  /**
   * Reload skills before each turn. Useful when the host owns filesystem loading
   * and wants edits to skill files to appear without restarting the agent.
   */
  refresh?: 'manual' | 'turn'
  registry?: SkillsRegistry
  toolName?: string
}

export interface SkillsRegistry {
  getDiagnostics: () => SkillDiagnostic[]
  getSkill: (name: string) => Skill | undefined
  getSkills: () => Skill[]
  refresh: () => Promise<SkillsRegistrySnapshot>
}

export interface SkillsRegistryOptions {
  diagnostics?: SkillDiagnostic[]
  loadSkills?: SkillsLoader
  skills?: Skill[]
}

export interface SkillsRegistrySnapshot {
  diagnostics: SkillDiagnostic[]
  skills: Skill[]
}

type MaybePromise<T> = Promise<T> | T

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

const normalizeSnapshot = (value: Skill[] | SkillsRegistrySnapshot): SkillsRegistrySnapshot =>
  Array.isArray(value)
    ? { diagnostics: [], skills: value }
    : {
        diagnostics: value.diagnostics.slice(),
        skills: value.skills.slice(),
      }

export const formatSkillsForSystemPrompt = (skills: readonly Skill[]): string => {
  const visibleSkills = skills.filter(skill => !skill.disableModelInvocation)
  if (visibleSkills.length === 0)
    return ''

  const lines = [
    'The following skills provide specialized instructions for specific tasks.',
    'When the task matches a skill description, call the skill tool with that skill name before answering.',
    'Do not read skill files directly when the skill tool is available.',
    '',
    '<available_skills>',
  ]

  for (const skill of visibleSkills) {
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
  const skillBlock = [
    `<skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`,
    `References are relative to ${escapeXml(dirnamePath(skill.filePath))}.`,
    '',
    skill.content,
    '</skill>',
  ].join('\n')

  return additionalInstructions == null || additionalInstructions.trim().length === 0
    ? skillBlock
    : `${skillBlock}\n\n${additionalInstructions.trim()}`
}

export const createSkillsRegistry = (options: SkillsRegistryOptions = {}): SkillsRegistry => {
  let snapshot: SkillsRegistrySnapshot = {
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

  return {
    getDiagnostics: () => snapshot.diagnostics.slice(),
    getSkill: skillName => snapshot.skills.find(skill => skill.name === skillName),
    getSkills: () => snapshot.skills.slice(),
    refresh,
  }
}

const skillToolInputSchema = z.object({
  additionalInstructions: z.string().optional().describe('Optional task-specific instructions to append after the skill content.'),
  name: z.string().describe('Skill name from the available_skills list.'),
})

const createSkillTool = async (registry: SkillsRegistry, toolName: string) => tool({
  description: 'Load the full instructions for an available skill by name. Use this before answering when a user request matches a listed skill.',
  execute: (input: unknown) => {
    const args = z.parse(skillToolInputSchema, input)
    const skill = registry.getSkill(args.name)

    if (skill == null || skill.disableModelInvocation)
      throw new Error(`Unknown skill: ${args.name}`)

    return formatSkillInvocation(skill, args.additionalInstructions)
  },
  name: toolName,
  parameters: skillToolInputSchema,
})

export const skills = (options: SkillsPluginOptions = {}): AgentPlugin => {
  const registry = options.registry ?? createSkillsRegistry(options)
  const refreshMode = options.refresh ?? (options.loadSkills == null ? 'manual' : 'turn')
  const toolName = options.toolName ?? 'skill'

  return {
    name,
    onTurnStart: async () => {
      if (refreshMode !== 'turn')
        return

      await registry.refresh()
    },
    prepareStep: ({ input }) => {
      const prompt = formatSkillsForSystemPrompt(registry.getSkills())
      if (prompt.length === 0)
        return {}

      return {
        input: [
          {
            content: prompt,
            role: 'system',
            type: 'message',
          } satisfies ItemParam,
          ...input,
        ],
      }
    },
    resolveTools: async () => {
      const hasVisibleSkills = registry.getSkills().some(skill => !skill.disableModelInvocation)

      return hasVisibleSkills
        ? [await createSkillTool(registry, toolName)]
        : undefined
    },
    version,
  }
}
