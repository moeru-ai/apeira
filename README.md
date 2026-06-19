# Apeira

stream-first Agent Runtime.

## Usage

```ts
import { createAgent, run } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const eventStream = run(agent, {
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})

for await (const event of eventStream)
  console.log(event.turnId, event.type)
```

`run()` returns a `ReadableStream` of events for the submitted turn. The stream
closes when the turn emits `turn.done`, `turn.failed`, or `turn.aborted`.

For fire-and-forget submission, subscribe to all agent events via `subscribe()` and use `send()`:

```ts
const unsubscribe = agent.subscribe('apeira', event =>
  console.log(event.turnId, event.type))

const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

`send()` returns a turn id immediately. If a turn is already active, the input
is queued for that turn and the returned id is the existing turn id.
Turn progress is reported through subscribed events.

Interrupt the active turn and record a model-visible turn-aborted boundary:

```ts
agent.interrupt('user interrupted')
```

The boundary is visible to the model on the next turn. The queue continues
normally — any queued turns run after the interrupted turn is aborted.

### Agent Lifecycle

Each agent keeps an append-only input log. When a turn starts, Apeira forks
that log into a working copy, appends the new input, assembles model input,
and passes it to the runner. When the turn completes
successfully, only the new working episodes are merged back. Failed or aborted
turns are discarded, except `interrupt()` records a boundary for the next turn.

Top-level turns submitted to the same agent with `run()` run one at a time. If
`send()` is called while a turn is active on that agent, the new input is
drained into that turn after the current model response completes.

The agent emits Apeira lifecycle events:

- `turn.queued`
- `turn.start`
- `turn.input_queued`
- `turn.input_drained`
- `turn.done`
- `turn.failed`
- `turn.aborted`

It also forwards streaming events from the runner, with `turnId`
attached to every event.

### State

Agent `state` is a plain object that plugins and instructions can read and write.

```ts
const agent = createAgent({
  initialState: { userId: 'user_123' },
  instructions: state => `You are helping ${state.userId ?? 'a user'}.`,
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

`initialState` is the agent's reset baseline. Update current state with
`agent.state.update(patch)`:

```ts
agent.state.update({ userId: 'user_456' })
```

### Abort And Reset

Abort the currently running turn without recording a boundary:

```ts
agent.abort('user cancelled')
```

Use `interrupt()` to abort and record a model-visible turn-aborted boundary.
Use `abort()` + `send()` to abort and submit different input.

Reset the agent:

```ts
agent.reset()
```

`reset()` aborts the running turn, clears queued turns and storage, then
restores `initialInput` and `initialState`.

You can also pass an external `AbortSignal` to a single turn:

```ts
const controller = new AbortController()

run(
  agent,
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
