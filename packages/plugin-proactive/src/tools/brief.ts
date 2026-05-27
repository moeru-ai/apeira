import type { ItemParam } from '@apeira/core'

import { tool } from '@xsai/tool'
import { z } from 'zod'

const briefSchema = z.object({
  content: z.string().describe('Brief content to send to the user. Keep it concise.'),
  importance: z.enum(['low', 'medium', 'high']).optional().describe('Importance level.'),
})

export const createBriefTool = async (send?: (input: ItemParam) => string) => tool({
  description: 'Send an unsolicited brief/update to the user. Use when you complete background work or encounter a blocker while the user is away.',
  execute: (input: unknown) => {
    const args = z.parse(briefSchema, input)
    send?.({ content: args.content, role: 'assistant', type: 'message' })
    return 'Brief sent.'
  },
  name: 'send_brief',
  parameters: briefSchema,
})
