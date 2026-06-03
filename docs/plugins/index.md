# Plugins

Plugins extend the agent lifecycle through a simple hook interface. Every feature beyond the core runtime — skills, storage, UI bridges — is a plugin.

For the full plugin interface and API details, see [Plugin API](/advanced/plugin-api).

## Using plugins

```ts
import { skills } from '@apeira/plugin-skills'
import { createAgent } from 'apeira'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [
    skills({
      sets: [mySkillSet],
    }),
  ],
})
```

## Available plugins

| Package | Description |
|---------|-------------|
| `@apeira/plugin-common-tools` | Common development tools (read, write, edit, bash, fetch, search). See [Common Tools](/plugins/common-tools). |
| `@apeira/plugin-hitl` | Human-in-the-loop tool approval. See [HITL](/plugins/hitl). |
| `@apeira/plugin-mcp` | Model Context Protocol integration. See [MCP](/plugins/mcp). |
| `@apeira/plugin-skills` | Filesystem-agnostic skills system. See [Skills](/plugins/skills). |
| `@apeira/plugin-ag-ui` | Bridges Apeira events to `@ag-ui/core` format. See [AG-UI](/plugins/ag-ui). |

## Building a custom plugin

```ts
import type { AgentPlugin } from '@apeira/core'

const loggingPlugin: AgentPlugin = {
  init: (agent) => {
    agent.subscribe('apeira', (event) => {
      if (event.type !== 'turn.failed')
        return

      console.error('turn failed:', event.error)
    })
  },
  name: 'logging',
  onFinish: ({ usage }) => {
    console.log('usage:', usage)
  },
}
```

Register it by passing it in the `plugins` array to `createAgent()`.
