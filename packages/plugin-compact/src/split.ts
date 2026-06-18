import type { AgentInput } from '@apeira/core'

const readContentPartText = (part: unknown): string => {
  if (typeof part !== 'object' || part === null)
    return ''

  const { refusal, text } = part as { refusal?: unknown, text?: unknown }

  if (typeof text === 'string')
    return text

  if (typeof refusal === 'string')
    return refusal

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
