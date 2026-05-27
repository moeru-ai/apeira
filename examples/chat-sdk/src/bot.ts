import type { AgentEvent } from '@apeira/core'

import { env, exit } from 'node:process'

import { createTelegramAdapter } from '@chat-adapter/telegram'
import { Chat } from 'chat'

import { agent } from './agent'
import { createMemoryState } from './state'

const TELEGRAM_USER_ID = env.TELEGRAM_USER_ID
const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN

export const startBot = async () => {
  if (TELEGRAM_USER_ID == null) {
    console.error('Please set the TELEGRAM_USER_ID environment variable.')
    exit(1)
  }

  if (TELEGRAM_BOT_TOKEN == null) {
    console.error('Please set the TELEGRAM_BOT_TOKEN environment variable.')
    exit(1)
  }

  const bot = new Chat({
    adapters: {
      telegram: createTelegramAdapter({
        botToken: TELEGRAM_BOT_TOKEN,
        mode: 'polling',
      }),
    },
    state: createMemoryState(),
    userName: 'apeira-bot',
  })

  await bot.initialize()

  /**
   * Convert an Apeira Agent event stream into a text stream
   * that Chat SDK can post to Telegram.
   */
  async function* agentTextStream(stream: ReadableStream<AgentEvent>): AsyncIterable<string> {
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done)
          break
        if (value.type === 'text.delta') {
          yield value.delta
        }
      }
    }
    finally {
      reader.releaseLock()
    }
  }

  /**
   * Handle new direct messages (unsubscribed DM threads).
   */
  bot.onDirectMessage(async (thread, message) => {
    if (String(message.author.userId) !== TELEGRAM_USER_ID) {
      await thread.post('🚫 Unauthorized user.')
      return
    }

    await thread.subscribe()

    const text = message.text?.trim()
    if (!text) {
      await thread.post('Please send a text message.')
      return
    }

    const session = agent.session({ id: thread.id })
    const stream = session.run({
      content: text,
      role: 'user',
      type: 'message',
    })

    await thread.post(agentTextStream(stream))
  })

  /**
   * Handle messages in already-subscribed threads.
   */
  bot.onSubscribedMessage(async (thread, message) => {
    if (message.author.userId !== TELEGRAM_USER_ID)
      return

    const text = message.text?.trim()
    if (!text) {
      await thread.post('Please send a text message.')
      return
    }

    const session = agent.session({ id: thread.id })
    const stream = session.run({
      content: text,
      role: 'user',
      type: 'message',
    })

    await thread.post(agentTextStream(stream))
  })
}
