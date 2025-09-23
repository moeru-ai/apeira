import type { ChatAgentPlugin } from '../agents/chat-agent'

import pkg from '../../package.json'

export interface TrimMessagesOptions {
  /** @default 20 */
  maxLength?: number
}

export const trimMessages = (options: TrimMessagesOptions = {}): ChatAgentPlugin => ({
  name: '@apeira/core/trim-messages',
  transformMessages: messages => [messages[0], ...messages.slice(1).slice(-((options.maxLength ?? 20) - 1))],
  version: pkg.version,
})
