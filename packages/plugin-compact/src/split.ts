import type { AgentInput } from '@apeira/core'

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

export const getMessageText = (item: AgentInput): string => {
  if (item.type !== 'message')
    return ''

  if (typeof item.content === 'string')
    return item.content

  return item.content
    .map(readContentPartText)
    .filter(text => text.length > 0)
    .join('\n')
}
