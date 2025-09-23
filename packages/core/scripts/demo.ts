import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

import { ChatAgent } from '../src/agents/chat-agent'
import { autoSaveMessages } from '../src/plugins/auto-save-messages'
import { trimMessages } from '../src/plugins/trim-messages'

const agent = new ChatAgent({
  instruction: 'You\'re a helpful assistant.',
  llm: {
    baseURL: 'http://localhost:11434/v1/',
    model: 'gpt-oss',
  },
  name: 'chat-agent',
  plugins: [
    autoSaveMessages(),
    trimMessages(),
  ],
})

await agent.start()

const rl = createInterface({ input, output })

try {
  while (true) {
    const content = await rl.question('> Write a message... ')

    const { textStream } = agent.run(content)

    for await (const textPart of textStream)
      output.write(textPart)

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
