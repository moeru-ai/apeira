# Runner

A runner is a backend adapter that turns an agent's instructions and input history into a stream of events. Apeira ships with two built-in runners: `responses()` for the OpenAI Responses API, and `chat()` for Chat Completions. You can also write your own.

## responses()

Uses the OpenAI [Responses API](https://platform.openai.com/docs/api-reference/responses) via `@xsai-ext/responses`.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

Runner options are passed to `@xsai-ext/responses`. Apeira supplies the request input, instructions, and lifecycle hooks. Common options include `model`, `apiKey`, `baseURL`, `temperature`, and `stopWhen`.

## chat()

Uses the Chat Completions API via `@xsai/stream-text`.

```ts twoslash
import { createAgent } from '@apeira/core'
import { chat } from '@apeira/core/chat'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: chat({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

Runner options are passed to `@xsai/stream-text`. Apeira supplies the messages and lifecycle hooks. Common options include `model`, `apiKey`, `baseURL`, `temperature`, `stop`, and `stopWhen`.

## Providers

You can use [`@xsai-ext/providers`](https://xsai.js.org/docs/packages-ext/providers) to avoid writing `apiKey` and `baseURL` manually.

### Predefined providers

```ts
import { createAgent } from '@apeira/core'
import { chat } from '@apeira/core/chat'
import { openai } from '@xsai-ext/providers'

const agent = createAgent({
  runner: chat({
    ...openai('gpt-5.5'),
  }),
})
```

Predefined providers read the API key from environment variables (e.g. `process.env.OPENAI_API_KEY`), so they only work in Node.js.

### Create providers

For runtime-agnostic code or explicit keys, use the `create` entry:

```ts
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { createGoogle } from '@xsai-ext/providers/create'

const google = createGoogle('foo-bar-baz')

const agent = createAgent({
  runner: responses({
    ...google('gemini-2.5-flash'),
  }),
})
```

The spread object includes `apiKey`, `baseURL`, and `model`, so you can mix in extra options:

```ts
import { stepCountAtLeast } from '@apeira/core'

const agent = createAgent({
  runner: chat({
    ...openai('gpt-5.5'),
    stopWhen: stepCountAtLeast(10),
    temperature: 0.5,
  }),
})
```

## Choosing a runner

Check whether your provider supports the Responses API. If it does, use `responses()`. Otherwise, use `chat()`.

- **`responses()`** — Responses API. Requires provider support.
- **`chat()`** — Chat Completions API. Works with any OpenAI-compatible endpoint, including local models and most third-party providers.

## Multi-step turns and `stopWhen`

Both runners support multi-step turns: after tool calls finish, the runner can automatically submit a follow-up request to the model. By default, Apeira stops after at most 20 steps:

```ts twoslash
import { stepCountAtLeast } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const runner = responses({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1/',
  model: 'gpt-5.5',
  stopWhen: stepCountAtLeast(10),
})
```

You can combine conditions:

```ts twoslash
import { and, hasToolCall, stepCountAtLeast } from '@apeira/core'
import { chat } from '@apeira/core/chat'

const runner = chat({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: 'https://api.openai.com/v1/',
  model: 'gpt-5.5',
  stopWhen: and(
    stepCountAtLeast(5),
    hasToolCall('deploy'),
  ),
})
```

Available stop helpers:

| Helper | Description |
|--------|-------------|
| `stepCountAtLeast(n)` | Stop when the step count reaches `n`. |
| `hasToolCall(name?)` | Stop after a tool call (optionally matching `name`). |
| `and(...conditions)` | All conditions must be true. |
| `or(...conditions)` | At least one condition must be true. |
| `not(condition)` | Negate a condition. |

## Custom runners

A runner is any function matching the `Runner` interface:

```ts twoslash
import type { Runner } from '@apeira/core'

const myRunner: Runner = async (context) => {
  // You must implement the full pipeline yourself:
  // - send the request to your backend
  // - handle streaming or polling
  // - execute tool calls and emit tool-result.done
  // - emit text.delta / text.start / text.done
  // - respect context.abortSignal
  // - return the final output

  context.channel.emit('apeira', {
    turnId: context.turnId,
    type: 'text.start',
  })

  // ... backend interaction ...

  return {
    output: [],
  }
}
```

A custom runner is responsible for model execution, tool execution, multi-step
loops, and emitting model/tool stream events through `context.channel`.

Turn lifecycle events such as `turn.start`, `turn.done`, `turn.failed`, and
`turn.aborted` are managed by Apeira's queue.

This is useful when you need to integrate a non-OpenAI backend, add custom preprocessing, or implement a mock runner for testing.
