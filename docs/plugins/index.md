# Plugins

Plugins extend the agent lifecycle through a simple hook interface. Every feature beyond the core runtime — skills, storage, UI bridges — is a plugin.

For the full plugin interface and API details, see [Plugin API](/advanced/plugin-api).

## Using plugins

```ts
import { skills } from '@apeira/plugin-skills'
import { createAgent } from 'apeira'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
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
  name: 'logging',
  onEvent: event => event.type === 'turn.failed' && console.error(event.error),
  onTurnDone: ({ snapshot, turnId }) => console.log('turn finished:', turnId, snapshot.episodic.length),
  onTurnStart: ({ turnId }) => {
    console.log('turn started:', turnId)
  },
}
```

Register it by passing it in the `plugins` array to `createAgent()`.


