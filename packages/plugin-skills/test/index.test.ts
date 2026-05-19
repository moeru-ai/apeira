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

describe('formatSkillsForSystemPrompt', () => {
  it('formats visible skills and skips model-disabled skills', () => {
    expect(formatSkillsForSystemPrompt([inspectSkill, hiddenSkill])).toContain('<name>inspect</name>')
    expect(formatSkillsForSystemPrompt([inspectSkill, hiddenSkill])).not.toContain('<name>hidden</name>')
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
  it('injects available skills through prepareStep without filesystem access', async () => {
    const plugin = skills({ skills: [inspectSkill] })
    const result = await plugin.prepareStep?.({
      input: [{ content: 'hello', role: 'user', type: 'message' }],
      model: 'test-model',
      stepNumber: 0,
      steps: [],
    })

    const injected = result?.input?.[0]

    expect(injected).toMatchObject({
      role: 'system',
      type: 'message',
    })
    expect(injected).toHaveProperty('content')
    if (injected != null && 'content' in injected)
      expect(String(injected.content)).toContain('<available_skills>')

    expect(result?.input?.[1]).toEqual({ content: 'hello', role: 'user', type: 'message' })
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
})
