# Event

Apeira is event-driven. Every emitted event includes the `turnId` of the turn it belongs to.

```ts twoslash
import type { AgentEvent } from '@apeira/core'

const describe = (event: AgentEvent) =>
  `${event.turnId}: ${event.type}`
```

## Lifecycle events

Apeira emits these lifecycle events:

| Event | Payload | Description |
|-------|---------|-------------|
| `turn.queued` | — | A turn was queued waiting for a running turn to finish. |
| `turn.start` | — | A turn started execution. |
| `turn.input_queued` | — | Input was queued into the active turn. |
| `turn.input_drained` | `{ count }` | Queued input was drained and submitted to the model. |
| `turn.done` | — | The turn completed successfully. |
| `turn.failed` | `{ error }` | The turn failed with an error. |
| `turn.aborted` | `{ reason? }` | The turn was aborted. |

## xsAI forwarded events

Apeira forwards streaming events from the runner and attaches the same `turnId`. These include:

- `step.start` — a model reasoning step started.
- `step.done` — a step completed.
- `text.delta` — a text content delta.
- `reasoning.delta` — a reasoning content delta.
- `tool-call.start` — a tool call was invoked.
- `tool-call.done` — a tool call completed.

Use the `type` field to narrow the event you care about:

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.subscribe('apeira', (event) => {
  if (event.type === 'turn.failed')
    console.error(event.error)

  if (event.type === 'text.delta')
    process.stdout.write(event.delta)
})
```

## Per-turn streams

`run()` returns a `ReadableStream` that is automatically filtered to the submitted turn.

```ts twoslash
import { createAgent, run } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const stream = run(agent, {
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})

for await (const event of stream) {
  if (event.type === 'turn.done')
    console.log('done')
}
```

The stream closes after `turn.done`, `turn.failed`, or `turn.aborted`.

## Global listeners

`subscribe('apeira', ...)` receives all core events from all turns.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const unsubscribe = agent.subscribe('apeira', event =>
  console.log(event.turnId, event.type))

unsubscribe()
```

The returned function removes the listener. Listener errors are silently ignored — one subscriber cannot break event delivery to others.

## Custom channels

Plugins can emit and listen on their own channels using `agent.emit()` and `agent.subscribe()`. The `'apeira'` channel carries core events; any other string is a custom channel. See [AgentChannel](/references/agent-channel) for the channel design and how to add typed custom events.
