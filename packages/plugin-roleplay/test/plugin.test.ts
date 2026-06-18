import type { AgentEntry } from '@apeira/core'

import type { RoleplayEvent } from '../src'

import { createAgent, developer, mem, run, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { compact } from '@apeira/plugin-compact'
import { describe, expect, it, vi } from 'vitest'

import { roleplay } from '../src'
import { createMockFetch, createV3Card } from './_shared'

const runner = responses({
  apiKey: 'test',
  baseURL: 'https://test',
  model: 'test',
})

const assistantText = (item: AgentEntry | undefined) => {
  const input = item?.type === 'input' ? (item as AgentEntry<'input'>).data : undefined
  if (input?.type !== 'message' || input.role !== 'assistant' || !Array.isArray(input.content))
    return undefined
  const part = input.content[0]
  return part != null && 'text' in part ? part.text : undefined
}

describe('roleplay plugin', () => {
  it('initializes the selected greeting', async () => {
    const agent = createAgent({
      initialState: { userName: 'Alice' },
      instructions: '',
      plugins: [roleplay({
        card: createV3Card({
          alternate_greetings: ['Welcome, {{user}}.'],
          first_mes: 'Hello.',
        }),
        greetingIndex: 1,
      })],
      runner,
    })
    const events: RoleplayEvent[] = []
    agent.subscribe('roleplay', (event) => {
      events.push(event)
    })

    await agent.init()

    expect(agent.state.get()).toEqual({ userName: 'Alice' })
    expect(assistantText((await agent.storage.read())[0])).toBe('Welcome, Alice.')
    expect(events).toContainEqual({
      greetingIndex: 1,
      hadContent: true,
      type: 'greeting.selected',
    })
  })

  it('does not add a greeting to restored history or for empty content', async () => {
    const restored = user('existing')
    const agent = createAgent({
      instructions: '',
      plugins: [roleplay({ card: createV3Card({ first_mes: 'Hello.' }) })],
      runner,
      storage: mem([restored]),
    })
    await agent.init()
    expect(await agent.storage.read()).toEqual([
      expect.objectContaining({ data: restored, type: 'input' }),
    ])

    const emptyAgent = createAgent({
      instructions: '',
      plugins: [roleplay({ card: createV3Card({ first_mes: '' }) })],
      runner,
    })
    await emptyAgent.init()
    expect(await emptyAgent.storage.read()).toEqual([])
  })

  it('restores and reevaluates the greeting after clear', async () => {
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0.99)
    const agent = createAgent({
      instructions: '',
      plugins: [roleplay({
        card: createV3Card({ first_mes: '{{pick:first,second}}' }),
      })],
      runner,
    })
    const events: RoleplayEvent[] = []
    agent.subscribe('roleplay', (event) => {
      events.push(event)
    })

    await agent.init()
    expect(assistantText((await agent.storage.read())[0])).toBe('first')

    await agent.reset()

    const inputs = (await agent.storage.read()).filter(e => e.type === 'input')
    expect(assistantText(inputs[0])).toBe('second')
    expect(events.at(-1)).toEqual({ greetingIndex: 0, type: 'session.reset' })
    random.mockRestore()
  })

  it('assembles instructions and temporary character input without persisting it', async () => {
    const mock = createMockFetch()
    const agent = createAgent({
      initialState: { userName: 'Alice' },
      instructions: '',
      plugins: [roleplay({
        card: createV3Card({
          creator_notes: 'Shown to the user, not the model.',
          description: 'A wandering mage.',
          first_mes: 'Greetings.',
          mes_example: '<START>\n{{char}}: First example.\n<START>\n{{user}}: Second example.',
          personality: 'Curious.',
          post_history_instructions: 'Stay in character as {{char}} for {{user}}.',
          scenario: 'A rainy tavern.',
          system_prompt: '{{original}}You are roleplaying as {{char}} for {{user}}.',
        }),
      })],
      runner: responses({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: mock.fetch,
        model: 'test',
      }),
    })
    const events: RoleplayEvent[] = []
    agent.subscribe('roleplay', (event) => {
      events.push(event)
    })

    for await (const event of run(agent, user('{{roll:6}} stays literal')))
      void event

    expect(mock.bodies[0]?.instructions).toBe([
      '\n',
      'You are roleplaying as Apeira for Alice.',
      '',
      '<example_dialogues>',
      'These are style and behavior examples, not events from the current conversation.',
      '<example_dialogue>',
      'Apeira: First example.',
      '</example_dialogue>',
      '<example_dialogue>',
      'Alice: Second example.',
      '</example_dialogue>',
      '</example_dialogues>',
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
    expect(mock.bodies[0]?.input).toContainEqual(user('{{roll:6}} stays literal'))
    expect(mock.bodies[0]?.input.at(-1)).toEqual({
      content: 'Stay in character as Apeira for Alice.',
      role: 'system',
      type: 'message',
    })
    expect(JSON.stringify(mock.bodies[0])).not.toContain('Shown to the user, not the model.')
    expect((await agent.storage.read()).some((item) => {
      if (item.type !== 'input')
        return false
      const input = (item as AgentEntry<'input'>).data
      return input.type === 'message' && input.role === 'system'
    })).toBe(false)
    const assembled = events.find(event => event.type === 'prompt.assembled')
    expect(assembled?.type).toBe('prompt.assembled')
    if (assembled?.type === 'prompt.assembled') {
      expect(assembled.categories).toEqual(['character', 'post_history_instructions'])
      expect(assembled.instructionExtension).toContain('roleplaying as Apeira')
      expect(assembled.instructionExtension).not.toContain('{{original}}')
      expect(assembled.temporaryInput).toEqual([
        expect.objectContaining({ role: 'system' }),
        expect.objectContaining({
          content: 'Stay in character as Apeira for Alice.',
          role: 'system',
        }),
      ])
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
        post_history_instructions: '{{pick:first,second}}',
        system_prompt: '{{pick:first,second}}',
      }),
    })
    const agent = createAgent({
      instructions: '',
      plugins: [plugin],
      runner,
    })
    await agent.init()

    await agent.emit('apeira', { turnId: 'one', type: 'turn.start' })
    expect(await plugin.extendInstructions?.({
      state: agent.state.get(),
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
    expect(first?.input?.at(-1)).toMatchObject({ content: 'first' })

    await agent.emit('apeira', { turnId: 'two', type: 'turn.start' })
    expect(await plugin.extendInstructions?.({
      state: agent.state.get(),
      turnId: 'two',
    })).toBe('second')
    random.mockRestore()
  })

  it('runs after compact and keeps roleplay context temporary', async () => {
    const main = createMockFetch()
    const summarizer = createMockFetch('summary')
    const agent = createAgent({
      initialState: { contextLength: 1_000 },
      instructions: '',
      plugins: [
        compact({
          compactAgent: {
            runner: responses({
              apiKey: 'test',
              baseURL: 'https://test',
              fetch: summarizer.fetch,
              model: 'summary',
            }),
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
      runner: responses({
        apiKey: 'test',
        baseURL: 'https://test',
        fetch: main.fetch,
        model: 'test',
      }),
      storage: mem([
        user('old one'),
        {
          content: [{ text: 'old answer one', type: 'output_text' }],
          role: 'assistant',
          type: 'message',
        },
        user('old two'),
        {
          content: [{ text: 'old answer two', type: 'output_text' }],
          role: 'assistant',
          type: 'message',
        },
      ]),
    })

    for await (const event of run(agent, user('live')))
      void event

    const temporary = main.bodies[0]?.input[0]
    expect(temporary?.type).toBe('message')
    if (temporary?.type === 'message') {
      expect(temporary.role).toBe('system')
      expect(temporary.content).toContain('Temporary definition.')
    }
    expect(main.bodies[0]?.input).toContainEqual(developer('<context_summary>\nsummary\n</context_summary>'))
    expect((await agent.storage.read()).some((item) => {
      if (item.type !== 'input')
        return false
      const input = (item as AgentEntry<'input'>).data
      return input.type === 'message' && input.role === 'system'
    })).toBe(false)
  })
})
