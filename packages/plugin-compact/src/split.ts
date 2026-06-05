import type { ItemParam } from '@apeira/core'

export interface SplitHistoryResult {
  compressible: ItemParam[]
  hasEnoughTurns: boolean
  preserved: ItemParam[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const readContentPartText = (part: unknown): string => {
  if (!isRecord(part))
    return ''

  if (typeof part.text === 'string')
    return part.text

  if (typeof part.refusal === 'string')
    return part.refusal

  return ''
}

export const getMessageText = (item: ItemParam): string => {
  if (item.type !== 'message')
    return ''

  if (typeof item.content === 'string')
    return item.content

  return item.content
    .map(readContentPartText)
    .filter(text => text.length > 0)
    .join('\n')
}

export const estimateTokens = (items: ItemParam[]): number => {
  const json = JSON.stringify(items)
  return Math.ceil(json.length / 4)
}

export const splitHistory = (items: ItemParam[], preserveTurns: number): SplitHistoryResult => {
  if (preserveTurns <= 0) {
    return {
      compressible: items,
      hasEnoughTurns: true,
      preserved: [],
    }
  }

  let userCount = 0
  let splitIndex = items.length

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.type === 'message' && item.role === 'user') {
      userCount++
      if (userCount === preserveTurns) {
        splitIndex = i
        break
      }
    }
  }

  return {
    compressible: items.slice(0, splitIndex),
    hasEnoughTurns: userCount >= preserveTurns,
    preserved: items.slice(splitIndex),
  }
}

export const selectRetainedUserMessages = (
  items: ItemParam[],
  maxTokens: number,
): string[] => {
  const userTexts = items
    .filter(item => item.type === 'message' && item.role === 'user')
    .map(getMessageText)
    .filter(text => text.length > 0)

  const selected: string[] = []
  let remaining = Math.max(0, maxTokens)

  for (const text of userTexts.toReversed()) {
    const tokens = Math.ceil(text.length / 4)

    if (tokens <= remaining) {
      selected.unshift(text)
      remaining -= tokens
    }
    else if (remaining > 0) {
      selected.unshift(text.slice(0, remaining * 4))
      break
    }
    else {
      break
    }
  }

  return selected
}

export const buildCompactInput = (
  compressible: ItemParam[],
  retained: string[],
): ItemParam[] => {
  return compressible.filter((item) => {
    if (item.type !== 'message' || item.role !== 'user')
      return true

    const text = getMessageText(item)
    const isRetained = retained.some(retainedText =>
      retainedText === text
      || (
        retainedText.length > 0
        && retainedText.length < text.length
        && text.startsWith(retainedText)
      ),
    )

    return !isRetained
  })
}
