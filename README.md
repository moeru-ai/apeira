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

For fire-and-forget submission, subscribe to all agent events via `on()` and use `send()`:

```ts
const unsubscribe = agent.subscribe('apeira', event =>
  console.log(event.turnId, event.type))

const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

`send()` returns a turn id immediately. If a turn is already active or scheduled,
the input is queued for that turn and the returned id is the existing turn id.
Turn progress is reported through subscribed events.

Interrupt the active turn and record a model-visible turn-aborted boundary:

```ts
agent.interrupt('user interrupted')
```

The boundary is visible to the model on the next turn. The queue continues
normally — any queued turns run after the interrupted turn is aborted.

### Agent Lifecycle

Each session keeps an in-memory `history` of completed turns. When a turn starts,
the new input is appended to the session history and passed to
`@xsai-ext/responses`. When the turn completes successfully, the returned input
state becomes the next session history.

Top-level turns submitted to the same session with `run()` run one at a time. If
`send()` is called while a turn is active or scheduled on that session, the new
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
and `sessionId` attached to every event.

### Sessions And Context

The root agent methods use a default session. Create explicit sessions when one
agent definition should serve multiple conversations:

```ts
const session = agent.session({
  context: {
    userId: 'user_123',
  },
})

session.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

Agent context starts as the complete default context. Agent, session, and run
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

session.setContext({ locale: 'zh-CN' })

session.run(input, {
  context: { requestId: 'req_123' },
})
```

`agent.setContext()` persists as the agent default. `session.setContext()`
persists for later turns on that session. Run context only applies to that
submitted input.

Calling `agent.session()` with an existing `id` returns that session and merges
the provided context overlay. The `input` option only applies when creating a
new session.

### Abort And Clear

Abort the currently running turn without recording a boundary:

```ts
agent.abort('user cancelled')
```

Use `interrupt()` to abort and record a model-visible turn-aborted boundary.
Use `abort()` + `send()` to abort and submit different input.

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
