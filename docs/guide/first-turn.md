# First Turn

This page walks through creating an agent, submitting a turn, and consuming the event stream.

## Create an agent

```ts
import { createAgent } from 'apeira'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})
```

`options` are forwarded to `@xsai-ext/responses` for model configuration. Apeira manages `input`, `instructions`, and `abortSignal` internally — you do not need to set them here.

## Run a turn

`run()` submits one user turn and returns a `ReadableStream` of events for that turn.

```ts
const stream = agent.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})

for await (const event of stream) {
  console.log(event.turnId, event.type)
}
```

The stream emits model events (`text.delta`, `tool-call.start`, etc.) and lifecycle events (`turn.start`, `turn.done`). It closes after `turn.done`, `turn.failed`, or `turn.aborted`.

## Fire-and-forget with send

Use `send()` when you only want the turn ID and plan to observe events through a global subscription.

```ts
const unsubscribe = agent.subscribe('apeira', (event) => {
  console.log(event.turnId, event.type)
})

const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})

// later
unsubscribe()
```

If no turn is active or scheduled, `send()` creates a new top-level turn. If a turn is already active or scheduled, it queues the input for that turn and returns the existing turn ID.

## Per-turn abort

Pass an `AbortSignal` to abort a specific turn:

```ts
const controller = new AbortController()

agent.run(input, { signal })

controller.abort('cancelled')
```

Cancelling the `ReadableStream` reader only stops reading events. It does not abort the running turn.


