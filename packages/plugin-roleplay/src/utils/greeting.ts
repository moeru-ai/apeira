import type { CharacterCardV3 } from '@risuai/ccardlib'

export interface SelectedGreeting {
  greeting: string
  index: number
}

export const selectGreeting = (
  card: CharacterCardV3,
  requestedIndex = 0,
): SelectedGreeting => {
  const index = Number.isInteger(requestedIndex) && requestedIndex > 0
    && requestedIndex <= card.data.alternate_greetings.length
    ? requestedIndex
    : 0

  return {
    greeting: index === 0
      ? card.data.first_mes
      : (card.data.alternate_greetings[index - 1] ?? card.data.first_mes),
    index,
  }
}
