import type { AgentStorage } from '@apeira/core'

import { env } from 'node:process'

import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { commonTools } from '@apeira/plugin-common-tools'

const model = env.APEIRA_MODEL ?? 'qwen3.5:0.8b'
const baseURL = env.APEIRA_BASE_URL ?? 'http://localhost:11434/v1'
const apiKey = env.OPENAI_API_KEY ?? env.APEIRA_API_KEY ?? 'ollama'

export const createChatAgent = (storage: AgentStorage) =>
  createAgent({
    instructions: 'You are a helpful assistant.',
    plugins: [
      commonTools({ include: ['search', 'fetch'] }),
    ],
    runner: responses({
      apiKey,
      baseURL,
      model,
    }),
    storage,
  })
