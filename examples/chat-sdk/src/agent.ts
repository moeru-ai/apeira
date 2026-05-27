import { join } from 'node:path'
import { env } from 'node:process'

import fsDriver from 'unstorage/drivers/fs'

import { createAgent } from '@apeira/core'
import { commonTools } from '@apeira/plugin-common-tools'
import { unstorage } from '@apeira/plugin-unstorage'

const model = env.APEIRA_MODEL ?? 'qwen3.5:0.8b'
const baseURL = env.APEIRA_BASE_URL ?? 'http://localhost:11434/v1'
const apiKey = env.OPENAI_API_KEY ?? env.APEIRA_API_KEY ?? 'ollama'

export const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'apeira-example-chat-sdk',
  options: {
    apiKey,
    baseURL,
    model,
  },
  plugins: [
    commonTools({ include: ['search', 'fetch'] }),
    unstorage({
      driver: fsDriver({ base: join(env.APEIRA_CWD ?? '.', '.apeira/sessions') }),
    }),
  ],
})
