import type { Skill } from '../src/index'

import { describe, expect, it } from 'vitest'

import {
  createSkillsRegistry,
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

const hiddenSkill: Skill = {
  content: 'Hidden instructions.',
  description: 'Use when explicitly requested.',
  disableModelInvocation: true,
  filePath: '/repo/agents/skills/hidden/SKILL.md',
  name: 'hidden',
}

const referencedSkill: Skill = {
  ...inspectSkill,
  references: [{
    description: 'Canonical text generation recipes.',
    path: 'references/recipes.md',
  }],
  source: 'project',
}

describe('formatSkillsForSystemPrompt', () => {
  it('formats visible skills and skips model-disabled skills', () => {
    expect(formatSkillsForSystemPrompt([inspectSkill, hiddenSkill])).toContain('<name>inspect</name>')
    expect(formatSkillsForSystemPrompt([inspectSkill, hiddenSkill])).not.toContain('<name>hidden</name>')
  })

  it('includes source metadata when provided', () => {
    expect(formatSkillsForSystemPrompt([referencedSkill])).toContain('<source>project</source>')
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

describe('createSkillsRegistry', () => {
  it('stores static skills and refreshes from host-provided loader', async () => {
    const registry = createSkillsRegistry({
      loadSkills: () => ({
        diagnostics: [{ code: 'example', message: 'loaded', type: 'warning' }],
        skills: [inspectSkill],
      }),
    })

    expect(registry.getSkills()).toEqual([])
    await registry.refresh()
    expect(registry.getSkill('inspect')).toEqual(inspectSkill)
    expect(registry.getDiagnostics()).toEqual([{ code: 'example', message: 'loaded', type: 'warning' }])
  })
})

describe('skills', () => {
  it('injects available skills through extendInstructions without filesystem access', async () => {
    const plugin = skills({ skills: [inspectSkill] })
    const result = await plugin.extendInstructions?.({
      agentName: 'agent',
      context: {},
      input: { content: 'hello', role: 'user', type: 'message' },
      signal: new AbortController().signal,
      threadId: 'thread',
      turnId: 'turn',
    })

    expect(result).toContain('<available_skills>')
  })

  it('refreshes from host loader at turn start', async () => {
    const registry = createSkillsRegistry({
      loadSkills: () => [inspectSkill],
    })
    const plugin = skills({ refresh: 'turn', registry })

    await plugin.onTurnStart?.({
      agentName: 'agent',
      context: {},
      input: { content: 'hello', role: 'user', type: 'message' },
      signal: new AbortController().signal,
      threadId: 'thread',
      turnId: 'turn',
    })

    expect(registry.getSkills()).toEqual([inspectSkill])
  })

  it('provides a skill tool backed by host-loaded registry content', async () => {
    const plugin = skills({ skills: [inspectSkill] })
    const tools = await plugin.resolveTools?.({
      agentName: 'agent',
      context: {},
      input: [{ content: 'hello', role: 'user', type: 'message' }],
      signal: new AbortController().signal,
      threadId: 'thread',
      tools: [],
      turnId: 'turn',
      turnInput: { content: 'hello', role: 'user', type: 'message' },
    })

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

  it('provides a skill_reference tool when host-loaded skills include references', async () => {
    const plugin = skills({
      loadSkillReference: (_skill, referencePath) =>
        referencePath === 'references/recipes.md'
          ? 'Use generateText for one-shot text generation.'
          : undefined,
      skills: [referencedSkill],
    })
    const tools = await plugin.resolveTools?.({
      agentName: 'agent',
      context: {},
      input: [{ content: 'hello', role: 'user', type: 'message' }],
      signal: new AbortController().signal,
      threadId: 'thread',
      tools: [],
      turnId: 'turn',
      turnInput: { content: 'hello', role: 'user', type: 'message' },
    })
    const referenceTool = tools?.find(candidate => candidate.function.name === 'skill_reference')

    expect(tools?.map(candidate => candidate.function.name)).toEqual(['skill', 'skill_reference'])
    expect(await referenceTool?.execute({ name: 'inspect', path: 'references/recipes.md' }, {
      messages: [],
      toolCallId: 'call_reference',
    })).toBe('<skill_reference skill="inspect" path="references/recipes.md">\nUse generateText for one-shot text generation.\n</skill_reference>')
  })
})
