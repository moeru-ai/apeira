import type { CharacterCardV3 } from '@risuai/ccardlib'

import type { CBSContext } from './cbs'

import { renderCBS } from './cbs'

const render = (value: string, context: CBSContext) =>
  renderCBS(value, context).text.trim()

export const assembleInstructionExtension = (
  card: CharacterCardV3,
  context: CBSContext,
): string => {
  const sections: string[] = []
  const systemPrompt = render(card.data.system_prompt, context)
  const example = render(card.data.mes_example, context)

  if (systemPrompt.length > 0)
    sections.push(systemPrompt)

  if (example.length > 0) {
    sections.push([
      '[Example dialogue. This is style guidance only, not conversation history.]',
      example,
      '[/Example dialogue]',
    ].join('\n'))
  }

  return sections.join('\n\n')
}

export const assembleCharacterDefinition = (
  card: CharacterCardV3,
  context: CBSContext,
): string => {
  const sections: string[] = []
  const name = render(card.data.nickname ?? card.data.name, context)
  const description = render(card.data.description, context)
  const personality = render(card.data.personality, context)
  const scenario = render(card.data.scenario, context)

  if (name.length > 0)
    sections.push(`Name: ${name}`)
  if (description.length > 0)
    sections.push(description)
  if (personality.length > 0)
    sections.push(`Personality:\n${personality}`)
  if (scenario.length > 0)
    sections.push(`Scenario:\n${scenario}`)

  return sections.join('\n\n')
}
