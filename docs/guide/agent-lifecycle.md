# Agent Lifecycle

An Apeira agent keeps an append-only input log and runs submitted turns one at a time.

## Input history

The agent starts with the optional initial history passed to `storage`.

```ts twoslash
import { createAgent, mem } from 'apeira'
import { responses } from 'apeira/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: mem([
    {
      content: 'The user\'s name is Alice.',
      role: 'user',
      type: 'message',
    },
  ]),
})
```

Initial history seeds the agent's input log. When a turn starts, Apeira appends the new input and passes the accumulated history to the configured runner. On success, the model output is appended to the history.

You can read the current storage entries at any time. Each entry has an `id`, `timestamp`, `type`, and `data` payload:

```ts twoslash
import { createAgent, mem } from 'apeira'
import { responses } from 'apeira/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  storage: mem(),
})

const currentEntries = await agent.storage.read()
```

## Queueing

Top-level turns on the same agent are serialized. If `run()` is called while another turn is running, the new turn waits until the running turn finishes.

```ts twoslash
import { createAgent, run } from 'apeira'
import { responses } from 'apeira/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const input = {
  content: 'Hello.',
  role: 'user',
  type: 'message',
} as const

const first = run(agent, input)
const second = run(agent, input) // waits for first
```

Different agents can run concurrently:

```ts twoslash
import { createAgent, run } from 'apeira'
import { responses } from 'apeira/responses'

const options = {
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
} as const

const agentA = createAgent(options)
const agentB = createAgent(options)

const input = {
  content: 'Hello.',
  role: 'user',
  type: 'message',
} as const

run(agentA, input) // starts immediately
run(agentB, input) // starts immediately, runs in parallel
```

`send()` queues input into the active turn if one exists, or creates a new
top-level turn.

## Interrupt vs abort vs clear

| Method | Clears queue | Resets input history | Resets state |
|--------|--------------|---------------------|--------------|
| `interrupt(reason)` | No | No | No |
| `abort(reason)` | No | No | No |
| `clear()` | Yes | Yes | Yes |

**Interrupt** aborts the active turn and records a model-visible `<turn_aborted>` boundary in the input history. The queue continues.

```ts twoslash
import { createAgent } from 'apeira'
import { responses } from 'apeira/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.interrupt('user interrupted')
```

**Abort** stops the running turn without recording a boundary.

```ts twoslash
import { createAgent } from 'apeira'
import { responses } from 'apeira/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.abort('user cancelled')
```

**Reset** aborts the running turn, removes queued turns, resets the input history to the original `storage`, and resets `state` to its initial value. The running turn emits `turn.aborted` with reason `reset`.

```ts twoslash
import { createAgent } from 'apeira'
import { responses } from 'apeira/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.reset()
```

## State

Agent `state` is a plain object that plugins and instructions can read and write.

```ts twoslash
import { createAgent } from 'apeira'
import { responses } from 'apeira/responses'

const agent = createAgent({
  initialState: { userName: 'user_123' },
  instructions: state => `You are helping ${state.userName ?? 'a user'}.`,
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

`initialState` is shared across all turns on the same agent. Use it for context that should persist across the agent's lifetime.
