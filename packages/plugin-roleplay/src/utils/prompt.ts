import type { CharacterCardV3 } from '@risuai/ccardlib'

import type { CBSContext } from './cbs'

import { renderCBS } from './cbs'

const render = (value: string, context: CBSContext) =>
  renderCBS(value, context).text.trim()

const formatExampleDialogues = (example: string): string => {
  const dialogues = example
    .split(/<START>/i)
    .map(dialogue => dialogue.trim())
    .filter(dialogue => dialogue.length > 0)

  if (dialogues.length === 0)
    return ''

  return [
    '<example_dialogues>',
    'These are style and behavior examples, not events from the current conversation.',
    ...dialogues.map(dialogue => [
      '<example_dialogue>',
      dialogue,
      '</example_dialogue>',
    ].join('\n')),
    '</example_dialogues>',
  ].join('\n')
}

export const assembleInstructionExtension = (
  card: CharacterCardV3,
  context: CBSContext,
): string => {
  const sections: string[] = []
  const systemPrompt = render(card.data.system_prompt, context)
  const example = render(card.data.mes_example, context)

  if (systemPrompt.length > 0)
    sections.push(systemPrompt)

  const exampleDialogues = formatExampleDialogues(example)
  if (exampleDialogues.length > 0)
    sections.push(exampleDialogues)

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

export const assemblePostHistoryInstructions = (
  card: CharacterCardV3,
  context: CBSContext,
): string => render(card.data.post_history_instructions, context)
