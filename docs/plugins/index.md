# Plugins

Plugins extend the agent lifecycle through a simple hook interface. They provide optional capabilities such as skills, compaction, tool approval, MCP integration, and UI bridges. Runners and storage backends are separate extension points.

::: warning Not yet published
The plugin packages are not published yet. Stay tuned.
:::

For the full plugin interface and API details, see [AgentPlugin](/references/agent-plugin).

## Using plugins

```ts
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { skills } from '@apeira/plugin-skills'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  plugins: [
    skills({
      sets: [mySkillSet],
    }),
  ],
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

## Available plugins

| Package | Description |
|---------|-------------|
| `@apeira/plugin-compact` | Automatic context compaction for long-running agents. See [Compact](/plugins/compact). |
| `@apeira/plugin-common-tools` | Common development tools (read, write, edit, bash, fetch, search). See [Common Tools](/plugins/common-tools). |
| `@apeira/plugin-hitl` | Human-in-the-loop tool approval. See [HITL](/plugins/hitl). |
| `@apeira/plugin-mcp` | Model Context Protocol integration. See [MCP](/plugins/mcp). |
| `@apeira/plugin-roleplay` | Character-card-driven, single-character roleplay. See [Roleplay](/plugins/roleplay). |
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
