# Agent

An Apeira agent is a turn pipeline with an event channel. This page covers how to create an agent, run turns, fork an agent, and manage its lifecycle.

## Create an agent

Use `createAgent()` with at least `instructions` and a `runner`.

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

`createAgent()` returns an `Agent` object that combines an [event channel](/references/agent-channel), a [turn queue](/references/agent-queue), state storage, and plugin hooks.

### Options

| Option | Description |
|--------|-------------|
| `instructions` | System prompt. Can be a string or a function `(state) => string`. |
| `runner` | The backend adapter, e.g. `responses()` or `chat()`. |
| `initialInput` | Seed input entries written to storage on first `init()`. See [Input](/guide/input). |
| `initialState` | Initial state object; restored on `reset()`. |
| `plugins` | Array of plugins to register. |
| `storage` | `AgentStorage` implementation. Defaults to `mem()`. |
| `tools` | Tools configured on the agent and available to every model call. See [Tools](/guide/tools). |

### Dynamic instructions

When `instructions` is a function, it receives the current `state` so the prompt can change between turns.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: state => `You are helping ${state.userName ?? 'a user'}.`,
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

## Run a turn

`run()` submits one input and returns a `ReadableStream` of events scoped to that turn.

```ts twoslash
import { createAgent, run, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const stream = run(agent, user('Say hello.'))

for await (const event of stream) {
  if (event.type === 'text.delta')
    process.stdout.write(event.delta)
}
```

`run()` is serializing: if another top-level turn is already running, the new turn waits until it finishes. The stream closes when the turn emits `turn.done`, `turn.failed`, or `turn.aborted`.

See [Input](/guide/input) for the input helpers used in the examples above.

## Fire-and-forget with send

`send()` returns a turn id immediately. Combine it with `subscribe()` to observe events globally.

```ts twoslash
import { createAgent, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const unsubscribe = agent.subscribe('apeira', event =>
  console.log(event.turnId, event.type))

const turnId = agent.send(user('Say hello.'))

// later
unsubscribe()
```

If a turn is already active, `send()` queues the input into that turn and returns the active turn id.

## Per-turn abort

Pass an `AbortSignal` to abort a specific turn without affecting the agent or the queue.

```ts twoslash
import { createAgent, run, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const controller = new AbortController()

run(agent, user('Write a long answer.'), { signal: controller.signal })

controller.abort('cancelled')
```

## Interrupt, abort, and reset

The agent exposes three control methods:

| Method | Effect | Records boundary | Clears queue | Restores baseline |
|--------|--------|------------------|--------------|-------------------|
| `interrupt(reason)` | Aborts the active turn. | Yes | No | No |
| `abort(reason)` | Aborts the active turn. | No | No | No |
| `reset()` | Aborts, clears storage, restores `initialInput`/`initialState`. | — | Yes | Yes |

`interrupt()` is useful when a user wants to stop the current response but keep the conversation going. The next turn sees a `<turn_aborted>` boundary.

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

agent.interrupt('user interrupted')
```

## State

Agent `state` is a plain object that instructions and plugins can read and write. Use `agent.state.get()`, `agent.state.set()`, and `agent.state.update()` to manage it.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: state => `You are helping ${state.userName ?? 'a user'}.`,
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.state.update({ userName: 'Bob' })
console.log(agent.state.get().userName)
```

See [State](/guide/state) for details on persistence, dynamic instructions, and extending state from plugins.

## Init and stop

`createAgent()` does not run plugin `init()` hooks immediately. They run lazily before the first turn. Call `agent.init()` explicitly if you need to warm up storage or plugins before the first turn.

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

await agent.init()
```

Call `agent.stop()` to run plugin `stop()` hooks in reverse order.

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

await agent.stop()
```

## Fork an agent

`fork()` creates a child agent that inherits the parent's `initialInput`, `initialState`, `instructions`, `plugins`, `runner`, tools, and current storage entries.

```ts twoslash
import { createAgent, fork, mem } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const parent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: mem(),
})

const child = await fork(parent, {
  inheritEntries: false,
  initialInput: parentInput => [...parentInput],
  storage: mem(),
})
```

Set `inheritEntries: false` to start from the child's initial input and state instead of copying the parent's current history.

Forked agents inherit the parent's tools by default. Pass `tools` to `fork()` to replace them for the child; plugin-provided tools follow the child's plugin configuration.

```ts
const child = await fork(parent, {
  tools: [childTool],
})
```
