import type { Message } from '@xsai/shared-chat'

import { stdin as input, stdout as output } from 'node:process'
import * as readline from 'node:readline/promises'

import { ChatAgent } from '../src/agents/chat-agent'

const agent = new ChatAgent({
  instruction: 'You\'re a helpful assistant.',
  llm: {
    baseURL: 'http://localhost:11434/v1/',
    model: 'aya-expanse:32b',
  },
  name: 'chat-agent',
})

const rl = readline.createInterface({ input, output })

let messages: Message[] | undefined

try {
  while (true) {
    const content = await rl.question('> Write a message... ')

    const { messages: pm, textStream } = agent.run(content, { messages })

    for await (const textPart of textStream)
      output.write(textPart)

    messages = await pm

    console.log('\n')
  }
}
catch (error) {
  console.error(error)
}
finally {
  rl.close()
  await agent.close()
}
