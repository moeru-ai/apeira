import type { ItemParam } from '@apeira/core'

import { env, exit } from 'node:process'

import { run } from '@apeira/core'
import { createTelegramAdapter } from '@chat-adapter/telegram'
import { Chat } from 'chat'

import { createChatAgent } from './agent'
import { createMemoryState } from './state'
import { readJSON, threadFilePath, writeJSON } from './storage'

const TELEGRAM_USER_ID = env.TELEGRAM_USER_ID
const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN

const threadInputs = new Map<string, ItemParam[]>()

const getThreadInput = async (threadId: string) => {
  const cached = threadInputs.get(threadId)
  if (cached != null)
    return cached

  const items = await readJSON<ItemParam>(threadFilePath(threadId))
  threadInputs.set(threadId, items)
  return items
}

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

  const handleMessage = async (thread: { id: string, post: (content: AsyncIterable<string> | string) => Promise<void> }, message: { text?: string }) => {
    const text = message.text?.trim()
    if (text == null) {
      await thread.post('Please send a text message.')
      return
    }

    const input = await getThreadInput(thread.id)
    input.push({ content: text, role: 'user', type: 'message' })

    const agent = createChatAgent(input)
    const stream = run(agent, {
      content: text,
      role: 'user',
      type: 'message',
    })

    // Stream text to Telegram while collecting the full response
    let assistantText = ''
    const textStream = (async function* () {
      const reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done)
            break
          if (value.type === 'text.delta') {
            assistantText += value.delta
            yield value.delta
          }
        }
      }
      finally {
        reader.releaseLock()
      }
    }())

    await thread.post(textStream)

    if (assistantText.length > 0) {
      input.push({ content: assistantText, role: 'assistant', type: 'message' })
    }

    await writeJSON(threadFilePath(thread.id), input)
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
    await handleMessage(thread, message)
  })

  /**
   * Handle messages in already-subscribed threads.
   */
  bot.onSubscribedMessage(async (thread, message) => {
    if (String(message.author.userId) !== TELEGRAM_USER_ID)
      return

    await handleMessage(thread, message)
  })
}
