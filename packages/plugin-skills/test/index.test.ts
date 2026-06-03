import type { Agent } from '@apeira/core'

import type { Skill } from '../src/index'

import fs from 'node:fs/promises'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { sleep } from '@moeru/std/sleep'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fsSkillSet } from '../src/fs'
import {
  createSkillSet,
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
  skills,
} from '../src/index'

const inspectSkill: Skill = {
  content: 'Inspect the code carefully.',
  description: 'Use when inspecting code.',
  filePath: '/repo/agents/skills/inspect/SKILL.md',
  name: 'inspect',
}

const referencedSkill: Skill = {
  ...inspectSkill,
  references: [{
    description: 'Canonical text generation recipes.',
    path: 'references/recipes.md',
  }],
}

describe('formatSkillsForSystemPrompt', () => {
  it('formats all skills into available_skills block', () => {
    const prompt = formatSkillsForSystemPrompt([inspectSkill])
    expect(prompt).toContain('<name>inspect</name>')
    expect(prompt).toContain('<available_skills>')
  })

  it('returns empty string for empty skills', () => {
    expect(formatSkillsForSystemPrompt([])).toBe('')
  })

  it('escapes xml metadata', () => {
    const prompt = formatSkillsForSystemPrompt([{
      ...inspectSkill,
      description: 'Use <fast> & "safe" mode.',
      filePath: '/repo/agents/skills/a&b/SKILL.md',
      name: 'a-b',
    }])

    expect(prompt).toContain('Use &lt;fast&gt; &amp; &quot;safe&quot; mode.')
    expect(prompt).toContain('/repo/agents/skills/a&amp;b/SKILL.md')
  })
})

describe('formatSkillInvocation', () => {
  it('wraps full skill content and additional instructions', () => {
    expect(formatSkillInvocation(inspectSkill, 'Focus on tests.')).toBe(
      '<skill name="inspect" location="/repo/agents/skills/inspect/SKILL.md">\nReferences are relative to /repo/agents/skills/inspect.\n\nInspect the code carefully.\n</skill>\n\nFocus on tests.',
    )
  })

  it('lists reference paths without loading reference content', () => {
    const invocation = formatSkillInvocation(referencedSkill)

    expect(invocation).toContain('Available references.')
    expect(invocation).toContain('- references/recipes.md: Canonical text generation recipes.')
    expect(invocation).not.toContain('Use generateText for one-shot text generation.')
  })
})

describe('createSkillSet', () => {
  it('stores static skills and refreshes from host-provided loader', async () => {
    const skillSet = createSkillSet({
      loadSkills: () => ({
        diagnostics: [{ code: 'example', message: 'loaded', type: 'warning' as const }],
        skills: [inspectSkill],
      }),
    })

    expect(skillSet.getSkills()).toEqual([])
    await skillSet.refresh()
    expect(skillSet.getSkill('inspect')).toEqual(inspectSkill)
    expect(skillSet.getDiagnostics()).toEqual([{ code: 'example', message: 'loaded', type: 'warning' }])
  })
})

describe('skills', () => {
  it('injects available skills through extendInstructions', async () => {
    const plugin = skills({ skills: [inspectSkill] })
    const result = await plugin.extendInstructions?.({})

    expect(result).toContain('<available_skills>')
  })

  it('refreshes from host loader at turn start', async () => {
    const skillSet = createSkillSet({ loadSkills: () => [inspectSkill] })
    const plugin = skills({ refresh: 'turn', sets: [skillSet] })

    // eslint-disable-next-line @masknet/type-no-force-cast-via-top-type
    const agent = {
      emit: () => {},
      subscribe: (_channel: string, listener: (event: unknown) => void) => {
        listener({ turnId: 'turn-1', type: 'turn.start' })
        return () => {}
      },
    } as unknown as Agent
    await plugin.init?.(agent)
    await sleep(10)

    expect(skillSet.getSkills()).toEqual([inspectSkill])
  })

  it('provides a skill tool backed by skill set content', async () => {
    const plugin = skills({ skills: [inspectSkill] })
    const tools = await plugin.extendTools?.({})

    expect(tools?.[0]?.function.name).toBe('skill')
    expect(await tools?.[0]?.execute({ additionalInstructions: 'Focus on tests.', name: 'inspect' }, {
      messages: [],
      toolCallId: 'call_1',
    })).toContain('Inspect the code carefully.')
    expect(await tools?.[0]?.execute({ name: 'inspect' }, {
      messages: [],
      toolCallId: 'call_2',
    })).toContain('Inspect the code carefully.')
  })

  it('provides a skill_reference tool when skills include references', async () => {
    const plugin = skills({
      sets: [createSkillSet({
        loadSkillReference: (_skill, referencePath) =>
          referencePath === 'references/recipes.md'
            ? 'Use generateText for one-shot text generation.'
            : undefined,
        skills: [referencedSkill],
      })],
    })
    const tools = await plugin.extendTools?.({})
    const referenceTool = tools?.find(candidate => candidate.function.name === 'skill_reference')

    expect(tools?.map(candidate => candidate.function.name)).toEqual(['skill', 'skill_reference'])
    expect(await referenceTool?.execute({ name: 'inspect', path: 'references/recipes.md' }, {
      messages: [],
      toolCallId: 'call_reference',
    })).toBe('<skill_reference skill="inspect" path="references/recipes.md">\nUse generateText for one-shot text generation.\n</skill_reference>')
  })

  it('accepts multiple sets via options.sets, deduplicating by name', async () => {
    const setA = createSkillSet({ skills: [inspectSkill] })
    const setB = createSkillSet({
      skills: [{ ...inspectSkill, content: 'Extra.', description: 'Extra skill.', filePath: '/x/SKILL.md', name: 'extra' }],
    })
    const plugin = skills({ sets: [setA, setB] })

    const result = await plugin.extendInstructions?.({})

    expect(result).toContain('<name>inspect</name>')
    expect(result).toContain('<name>extra</name>')
  })

  it('respects priority when merging sets', async () => {
    const low = createSkillSet({ priority: 0, skills: [{ ...inspectSkill, description: 'low' }] })
    const high = createSkillSet({ priority: 10, skills: [{ ...inspectSkill, description: 'high' }] })
    const plugin = skills({ sets: [low, high] })

    await plugin.extendTools?.({})

    // high priority wins dedupe
    expect(plugin.extendInstructions?.({})).toContain('high')
  })
})

describe('fsSkillSet', () => {
  const testDir = path.join(fileURLToPath(new URL('.', import.meta.url)), 'test-skills')

  beforeEach(async () => {
    await fs.mkdir(path.join(testDir, 'math', 'references'), { recursive: true })
    await fs.mkdir(path.join(testDir, 'code-review'), { recursive: true })

    await fs.writeFile(
      path.join(testDir, 'math', 'SKILL.md'),
      '---\nname: math\ndescription: Expert math problem solving.\n---\n\n# Math\nUse proper notation and show steps.',
    )
    await fs.writeFile(
      path.join(testDir, 'math', 'references', 'formulas.md'),
      '# Formulas\nE=mc^2',
    )
    await fs.writeFile(
      path.join(testDir, 'code-review', 'SKILL.md'),
      '---\ndescription: Review code for issues.\n---\n\n# Code Review\nReview all code.',
    )
  })

  afterEach(async () => {
    await fs.rm(testDir, { force: true, recursive: true })
  })

  it('reads skills from directory with frontmatter', async () => {
    const skillSet = fsSkillSet({ directory: testDir })

    await skillSet.refresh()
    const skills = skillSet.getSkills()

    expect(skills).toHaveLength(2)
    const math = skillSet.getSkill('math')
    expect(math?.description).toBe('Expert math problem solving.')
    expect(math?.content).toContain('Use proper notation')
    expect(math?.filePath).toBe(path.join(testDir, 'math', 'SKILL.md'))
  })

  it('uses directory name when name not in frontmatter', async () => {
    const skillSet = fsSkillSet({ directory: testDir })

    await skillSet.refresh()
    const review = skillSet.getSkill('code-review')
    expect(review?.name).toBe('code-review')
    expect(review?.description).toBe('Review code for issues.')
  })

  it('loads reference files lazily', async () => {
    const skillSet = fsSkillSet({ directory: testDir })

    await skillSet.refresh()
    expect(skillSet.getSkill('math')?.references?.map(reference => reference.path)).toContain('references/formulas.md')

    const ref = await skillSet.getSkillReference('math', 'references/formulas.md')
    expect(ref?.content).toContain('E=mc^2')
  })
})
