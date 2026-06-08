import type { ItemParam } from '@apeira/core'
import type { CharacterCardV1, CharacterCardV2, CharacterCardV3 } from '@risuai/ccardlib'

export const createV1Card = (
  overrides: Partial<CharacterCardV1> = {},
): CharacterCardV1 => ({
  description: 'A wandering mage.',
  first_mes: 'Hello, {{user}}.',
  mes_example: '<START>\n{{char}}: Welcome.',
  name: 'Apeira',
  personality: 'Curious.',
  scenario: 'A rainy tavern.',
  ...overrides,
})

export const createV2Card = (
  overrides: Partial<CharacterCardV2['data']> = {},
): CharacterCardV2 => ({
  data: {
    alternate_greetings: [],
    character_version: '1',
    creator: 'test',
    creator_notes: '',
    description: 'A wandering mage.',
    extensions: {},
    first_mes: 'Hello.',
    mes_example: '',
    name: 'Apeira',
    personality: 'Curious.',
    post_history_instructions: '',
    scenario: 'A rainy tavern.',
    system_prompt: '',
    tags: [],
    ...overrides,
  },
  spec: 'chara_card_v2',
  spec_version: '2.0',
})

export const createV3Card = (
  overrides: Partial<CharacterCardV3['data']> = {},
): CharacterCardV3 => ({
  data: {
    alternate_greetings: [],
    character_version: '1',
    creator: 'test',
    creator_notes: '',
    description: 'A wandering mage.',
    extensions: {},
    first_mes: 'Hello.',
    group_only_greetings: [],
    mes_example: '',
    name: 'Apeira',
    personality: 'Curious.',
    post_history_instructions: '',
    scenario: 'A rainy tavern.',
    system_prompt: '',
    tags: [],
    ...overrides,
  },
  spec: 'chara_card_v3',
  spec_version: '3.0',
})

export const userMessage = (content: string): ItemParam => ({
  content,
  role: 'user',
  type: 'message',
})

export const createMockFetch = (responseText = 'response') => {
  const bodies: Array<{ input: ItemParam[], instructions?: string }> = []

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { input: ItemParam[], instructions?: string }
    bodies.push(body)

    const assistant = {
      content: [{ text: responseText, type: 'output_text' }],
      role: 'assistant',
      type: 'message',
    }
    const encoder = new TextEncoder()

    return new Response(new ReadableStream({
      start: (controller) => {
        controller.enqueue(encoder.encode('data: {"type":"response.created"}\n\n'))
        const outputItem = JSON.stringify({
          item: assistant,
          output_index: 0,
          type: 'response.output_item.done',
        })
        const completed = JSON.stringify({
          response: {
            output: [assistant],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
          type: 'response.completed',
        })
        controller.enqueue(encoder.encode(`data: ${outputItem}\n\n`))
        controller.enqueue(encoder.encode(`data: ${completed}\n\n`))
        controller.close()
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } })
  }

  return { bodies, fetch }
}
