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
const unsubscribe = agent.subscribe(event =>
  console.log(event.turnId, event.type)
)

const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

`send()` returns a turn id immediately. If a turn is already active or scheduled,
the input is queued for that turn and the returned id is the existing turn id.
Turn progress is reported through subscribed events.

Interrupt the active turn with replacement input:

```ts
const turnId = agent.interrupt({
  content: 'Actually, answer this instead.',
  role: 'user',
  type: 'message',
})
```

`interrupt()` aborts the active turn, records a model-visible turn-aborted
boundary, and sends the replacement input to the next queued turn or a new turn.

### Agent Lifecycle

Each thread keeps an in-memory `history` of completed turns. When a turn starts,
the new input is appended to the thread history and passed to
`@xsai-ext/responses`. When the turn completes successfully, the returned input
state becomes the next thread history.

Top-level turns submitted to the same thread with `run()` run one at a time. If
`send()` is called while a turn is active or scheduled on that thread, the new
input is drained into that turn after the current model response completes.

The agent emits Apeira lifecycle events:

- `turn.queued`
- `turn.start`
- `turn.input_queued`
- `turn.input_drained`
- `turn.done`
- `turn.failed`
- `turn.aborted`

It also forwards streaming events from `@xsai-ext/responses`, with `turnId`
and `threadId` attached to every event.

### Threads And Context

The root agent methods use a default thread. Create explicit threads when one
agent definition should serve multiple conversations:

```ts
const thread = agent.thread({
  context: {
    userId: 'user_123',
  },
})

thread.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

Agent context starts as the complete default context. Agent, thread, and run
context updates are partial overlays. Instructions receive the merged context:

```ts
const agent = createAgent({
  context: {
    locale: 'en-US',
    product: 'docs',
  },
  instructions: context => `Use locale ${context.locale}.`,
  name: 'assistant',
  options,
})

thread.setContext({ locale: 'zh-CN' })

thread.run(input, {
  context: { requestId: 'req_123' },
})
```

`agent.setContext()` persists as the agent default. `thread.setContext()`
persists for later turns on that thread. Run context only applies to that
submitted input.

Calling `agent.thread()` with an existing `id` returns that thread and merges
the provided context overlay. The `input` option only applies when creating a
new thread.

### Abort And Clear

Abort the currently running turn:

```ts
agent.abort('user cancelled')
```

Abort stops the active turn without submitting replacement input. Use
`interrupt()` when a user wants to stop the active turn and continue with new
input.

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
  {
    signal: controller.signal,
  },
)

controller.abort('cancelled')
```

Canceling the `ReadableStream` reader only stops reading events. It does not
abort the running turn.

## License

[MIT](LICENSE.md)
