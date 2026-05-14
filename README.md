# Apeira

stream-first Agent Runtime.

## Usage

```ts
import { createAgent } from '@apeira/core'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})

const eventStream = agent.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})

for await (const event of eventStream)
  console.log(event.turnId, event.type)
```

`run()` returns a `ReadableStream` of events for the submitted turn. The stream
closes when the turn emits `turn.done`, `turn.failed`, or `turn.aborted`.

For fire-and-forget submission, subscribe to all agent events and use `send()`:

```ts
const unsubscribe = agent.subscribe((event) => {
  console.log(event.turnId, event.type)
})

const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

`send()` returns a turn id immediately. If a turn is already active or scheduled,
the input is queued for that turn and the returned id is the existing turn id.
Turn progress is reported through subscribed events.

### Agent Lifecycle

Each agent keeps an in-memory `history` of completed turns. When a turn starts,
the new input is appended to the current history and passed to
`@xsai-ext/responses`. When the turn completes successfully, the returned input
state becomes the next history.

Top-level turns submitted with `run()` run one at a time. If `send()` is called
while a turn is active or scheduled, the new input is drained into that turn
after the current model response completes.

The agent emits Apeira lifecycle events:

- `turn.queued`
- `turn.start`
- `turn.input_queued`
- `turn.input_drained`
- `turn.done`
- `turn.failed`
- `turn.aborted`

It also forwards streaming events from `@xsai-ext/responses`, with `turnId`
attached to every event.

### Abort And Clear

Abort the currently running turn:

```ts
agent.abort('user cancelled')
```

Clear the session:

```ts
agent.clear()
```

`clear()` aborts the running turn, clears queued turns, and resets in-memory
history.

You can also pass an external `AbortSignal` to a single turn:

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

Canceling the `ReadableStream` reader only stops reading events. It does not
abort the running turn.

## License

[MIT](LICENSE.md)
