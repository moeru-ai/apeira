import type { ItemParam } from '@apeira/core'

import type { RoleplayEvent } from '../src'

import { createAgent, run } from '@apeira/core'
import { compact } from '@apeira/plugin-compact'
import { describe, expect, it, vi } from 'vitest'

import { roleplay } from '../src'
import { createMockFetch, createV3Card, userMessage } from './_shared'

const assistantText = (item: ItemParam | undefined) => {
  if (item?.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content))
    return undefined
  const part = item.content[0]
  return part != null && 'text' in part ? part.text : undefined
}

describe('roleplay plugin', () => {
  it('initializes the selected greeting', async () => {
    const agent = createAgent({
      instructions: '',
      options: {
        apiKey: 'test',
        baseURL: 'https://test',
        model: 'test',
      },
      plugins: [roleplay({
        card: createV3Card({
          alternate_greetings: ['Welcome, {{user}}.'],
          first_mes: 'Hello.',
        }),
        greetingIndex: 1,
      })],
      state: { userName: 'Alice' },
    })
    const events: RoleplayEvent[] = []
    agent.subscribe('roleplay', event => events.push(event))

    await agent.init()

    expect(agent.getState()).toEqual({ userName: 'Alice' })
    expect(assistantText(agent.getInput()[0])).toBe('Welcome, Alice.')
    expect(events).toContainEqual({
      greetingIndex: 1,
      hadContent: true,
      type: 'greeting.selected',
    })
  })

  it('does not add a greeting to restored history or for empty content', async () => {
    const restored = userMessage('existing')
    const agent = createAgent({
      input: [restored],
      instructions: '',
      options: { apiKey: 'test', baseURL: 'https://test', model: 'test' },
      plugins: [roleplay({ card: createV3Card({ first_mes: 'Hello.' }) })],
    })
    await agent.init()
    expect(agent.getInput()).toEqual([restored])

    const emptyAgent = createAgent({
      instructions: '',
      options: { apiKey: 'test', baseURL: 'https://test', model: 'test' },
      plugins: [roleplay({ card: createV3Card({ first_mes: '' }) })],
    })
    await emptyAgent.init()
    expect(emptyAgent.getInput()).toEqual([])
  })

  it('restores and reevaluates the greeting after clear', async () => {
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99)
    const agent = createAgent({
      instructions: '',
      options: { apiKey: 'test', baseURL: 'https://test', model: 'test' },
      plugins: [roleplay({
        card: createV3Card({ first_mes: '{{pick:first,second}}' }),
      })],
    })
    const events: RoleplayEvent[] = []
    agent.subscribe('roleplay', event => events.push(event))

    await agent.init()
    expect(assistantText(agent.getInput()[0])).toBe('first')

    agent.clear()

    expect(assistantText(agent.getInput()[0])).toBe('second')
    expect(events.at(-1)).toEqual({ greetingIndex: 0, type: 'session.reset' })
    random.mockRestore()
  })

  it('assembles instructions and temporary character input without persisting it', async () => {
    const mock = createMockFetch()
    const agent = createAgent({
      instructions: '',
      options: {
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: mock.fetch,
        model: 'test',
      },
      plugins: [roleplay({
        card: createV3Card({
          description: 'A wandering mage.',
          first_mes: 'Greetings.',
          mes_example: '<START>\n{{char}}: Example.',
          personality: 'Curious.',
          scenario: 'A rainy tavern.',
          system_prompt: 'You are roleplaying as {{char}} for {{user}}.',
        }),
      })],
      state: { userName: 'Alice' },
    })
    const events: RoleplayEvent[] = []
    agent.subscribe('roleplay', event => events.push(event))

    for await (const event of run(agent, userMessage('{{roll:6}} stays literal')))
      void event

    expect(mock.bodies[0]?.instructions).toBe([
      '\n',
      'You are roleplaying as Apeira for Alice.',
      '',
      '[Example dialogue. This is style guidance only, not conversation history.]',
      '<START>\nApeira: Example.',
      '[/Example dialogue]',
    ].join('\n'))
    expect(mock.bodies[0]?.input[0]).toEqual({
      content: [
        'Name: Apeira',
        'A wandering mage.',
        'Personality:\nCurious.',
        'Scenario:\nA rainy tavern.',
      ].join('\n\n'),
      role: 'system',
      type: 'message',
    })
    expect(mock.bodies[0]?.input).toContainEqual(userMessage('{{roll:6}} stays literal'))
    expect(agent.getInput().some(item =>
      item.type === 'message' && item.role === 'system')).toBe(false)
    const assembled = events.find(event => event.type === 'prompt.assembled')
    expect(assembled?.type).toBe('prompt.assembled')
    if (assembled?.type === 'prompt.assembled') {
      expect(assembled.categories).toEqual(['character'])
      expect(assembled.instructionExtension).toContain('roleplaying as Apeira')
      expect(assembled.temporaryInput[0]).toMatchObject({ role: 'system' })
    }
  })

  it('shares pick values across hooks and resets them on a new turn', async () => {
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99)
    const plugin = roleplay({
      card: createV3Card({
        description: '{{pick:first,second}}',
        first_mes: '',
        system_prompt: '{{pick:first,second}}',
      }),
    })
    const agent = createAgent({
      instructions: '',
      options: { apiKey: 'test', baseURL: 'https://test', model: 'test' },
      plugins: [plugin],
    })
    await agent.init()

    agent.emit('apeira', { turnId: 'one', type: 'turn.start' })
    expect(await plugin.extendInstructions?.({
      state: agent.getState(),
      turnId: 'one',
    })).toBe('first')
    const first = await plugin.prepareStep?.({
      input: [],
      model: 'test',
      stepNumber: 0,
      steps: [],
    })
    const continuation = await plugin.prepareStep?.({
      input: [],
      model: 'test',
      stepNumber: 1,
      steps: [],
    })
    expect(first?.input).toEqual(continuation?.input)
    const firstItem = first?.input?.[0]
    expect(firstItem?.type).toBe('message')
    if (firstItem?.type === 'message' && typeof firstItem.content === 'string')
      expect(firstItem.content).toContain('first')

    agent.emit('apeira', { turnId: 'two', type: 'turn.start' })
    expect(await plugin.extendInstructions?.({
      state: agent.getState(),
      turnId: 'two',
    })).toBe('second')
    random.mockRestore()
  })

  it('runs after compact and keeps roleplay context temporary', async () => {
    const main = createMockFetch()
    const summarizer = createMockFetch('summary')
    const agent = createAgent({
      input: [
        userMessage('old one'),
        {
          content: [{ text: 'old answer one', type: 'output_text' }],
          role: 'assistant',
          type: 'message',
        },
        userMessage('old two'),
        {
          content: [{ text: 'old answer two', type: 'output_text' }],
          role: 'assistant',
          type: 'message',
        },
      ],
      instructions: '',
      options: {
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'test',
      },
      plugins: [
        compact({
          compactAgent: {
            options: {
              apiKey: 'test',
              baseURL: 'https://test',
              fetch: summarizer.fetch,
              model: 'summary',
            },
          },
          preserveTurns: 1,
          threshold: 0,
        }),
        roleplay({
          card: createV3Card({
            description: 'Temporary definition.',
            first_mes: '',
          }),
        }),
      ],
      state: { contextLength: 1_000 },
    })

    for await (const event of run(agent, userMessage('live')))
      void event

    const temporary = main.bodies[0]?.input[0]
    expect(temporary?.type).toBe('message')
    if (temporary?.type === 'message') {
      expect(temporary.role).toBe('system')
      expect(temporary.content).toContain('Temporary definition.')
    }
    expect(main.bodies[0]?.input).toContainEqual(userMessage('[Context Summary]\nsummary'))
    expect(agent.getInput().some(item =>
      item.type === 'message' && item.role === 'system')).toBe(false)
  })
})
