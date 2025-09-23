import type { Message } from '@xsai/shared-chat'

import type { ChatAgentPlugin } from '../agents/chat-agent'

import pkg from '../../package.json'

export interface AutoSaveMessagesOptions {
  load?: () => Message[] | Promise<Message[]>
  save?: (messages: Message[]) => Promise<void> | void
}

export const autoSaveMessages = (options: AutoSaveMessagesOptions = {}): ChatAgentPlugin => {
  let messages: Message[] = []

  return {
    close: async () => options.save?.(messages),
    name: '@apeira/core/auto-save-messages',
    onFinish: (step) => {
      if (step?.text != null)
        messages.push({ content: step.text, role: 'assistant' })
    },
    onRun: content => messages.push({ content, role: 'user' }),
    start: async () => { messages = await options.load?.() ?? [] },
    transformMessages: (prev) => {
      if (prev.length === 1)
        messages = prev

      return messages
    },
    version: pkg.version,
  }
}
