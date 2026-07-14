# Tools

Tools are configured on the agent, not when creating a runner. This keeps the tool set independent from the model transport: the same tools can be used with `responses()`, `chat()`, or a custom runner.

## Tool definitions

`@apeira/core` re-exports xsAI's `defineTool` as `tool`, and re-exports xsAI's `rawTool` unchanged from `@xsai/tool`.

### `tool()`

Use `tool()` with a [Standard JSON Schema](https://standardschema.dev/json-schema)-compatible library such as Zod or Valibot:

```ts twoslash
import { tool } from '@apeira/core'
import { z } from 'zod'

const greet = tool({
  description: 'Greets a person by name.',
  execute: ({ name }) => `Hello, ${name}!`,
  name: 'greet',
  parameters: z.object({
    name: z.string().describe('The person to greet.'),
  }),
})
```

### `rawTool()`

Use `rawTool()` when you already have a JSON Schema object:

```ts twoslash
import { rawTool } from '@apeira/core'

const greet = rawTool({
  description: 'Greets a person by name.',
  execute: (input: unknown) => `Hello, ${(input as { name: string }).name}!`,
  name: 'greet',
  parameters: {
    additionalProperties: false,
    properties: {
      name: { description: 'The person to greet.', type: 'string' },
    },
    required: ['name'],
    type: 'object',
  },
})
```

## Agent tools

Pass the resulting tool definitions to `createAgent()` with the `tools` option. The same tools can be used with `responses()`, `chat()`, or a custom runner:

```ts twoslash
import type { Tool } from '@apeira/core'

import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

// `greet` is defined in the previous section.
declare const greet: Tool

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  tools: [greet],
})
```

## Plugin tools

Plugins can provide tools dynamically with `extendTools`. The hook runs for each turn and receives the turn's signal, state, and id:

```ts twoslash
import type { AgentPlugin } from '@apeira/core'

const timeToolPlugin: AgentPlugin = {
  extendTools: () => [
    {
      execute: () => new Date().toISOString(),
      function: {
        name: 'current_time',
        parameters: { properties: {}, type: 'object' },
      },
      type: 'function',
    },
  ],
  name: 'time-tool',
}
```

Use an existing plugin by adding it to `createAgent({ plugins })`. For example, [`@apeira/plugin-common-tools`](/plugins/common-tools) provides tools for reading, writing, editing, shell commands, fetching, and web search.

## Tool order and lifecycle

For each turn, Apeira combines tools in this order:

1. `CreateAgentOptions.tools`
2. Tools returned by plugins' `extendTools` hooks, in plugin order

The combined list is passed to the runner through `RunnerContext.tools`. Plugin tools are resolved again on every turn, so they can depend on current state or cancellation signals.

The `tools` option belongs on `createAgent()`, not on `responses()` or `chat()`.
