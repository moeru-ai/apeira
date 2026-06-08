import type { ItemParam } from '@apeira/core'

export const assistantMessage = (text: string): ItemParam => ({
  content: [{ text, type: 'output_text' }],
  role: 'assistant',
  type: 'message',
})

export const systemMessage = (text: string): ItemParam => ({
  content: text,
  role: 'system',
  type: 'message',
})
