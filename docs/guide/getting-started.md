# Getting Started

Apeira is a stream-first agent runtime for TypeScript. It wraps
`@xsai-ext/responses` with a small agent abstraction for turn queueing,
session history, cancellation, and event delivery.

## Install

Use the umbrella package:

```sh
pnpm add apeira
```

Or import the core package directly:

```sh
pnpm add @apeira/core
```

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

`options` are forwarded to `@xsai-ext/responses`, except for fields Apeira
manages internally, such as `input`, `instructions`, and `abortSignal`.

## Run a turn

`run()` submits one user turn and returns a `ReadableStream` of events for that
turn.

```ts
const stream = agent.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})

for await (const event of stream)
  console.log(event.turnId, event.type)
```

The stream closes when the turn emits one of:

- `turn.done`
- `turn.failed`
- `turn.aborted`

## Fire and forget

Use `subscribe()` with `send()` when you want a global event listener and an
immediate turn id.

```ts
const unsubscribe = agent.subscribe((event) => {
  console.log(event.turnId, event.type)
})

const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})

console.log(turnId)

unsubscribe()
```

If no turn is active or scheduled, `send()` creates a new top-level turn. If a
turn is already active or scheduled, it queues the input for that turn and
returns the existing turn id.

## Abort a turn

Abort the currently running turn:

```ts
agent.abort('user cancelled')
```

Or pass an `AbortSignal` for a specific submitted turn:

```ts
const controller = new AbortController()

agent.run(
  {
    content: 'Write a long answer.',
    role: 'user',
    type: 'message',
  },
  controller.signal,
)

controller.abort('cancelled')
```

Canceling a `ReadableStream` reader only stops reading events. It does not abort
the running turn.
