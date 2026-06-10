# Agent Lifecycle

An Apeira agent keeps an append-only input log and runs submitted turns one at a time.

## Input history

The agent starts with the optional `input` passed to `createAgent()`.

```ts
const agent = createAgent({
  input: [
    {
      content: 'The user\'s name is Alice.',
      role: 'user',
      type: 'message',
    },
  ],
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

Initial `input` seeds the agent's history. When a turn starts, Apeira appends the new input and passes the accumulated history to the configured runner. On success, the model output is appended to the history.

You can read the current accumulated input at any time:

```ts
const currentInput = agent.getInput()
```

## Queueing

Top-level turns on the same agent are serialized. If `run()` is called while another turn is running, the new turn waits until the running turn finishes.

```ts
import { run } from 'apeira'

const first = run(agent, input)
const second = run(agent, input) // waits for first
```

Different agents can run concurrently:

```ts
const agentA = createAgent({ ...options })
const agentB = createAgent({ ...options })

run(agentA, input) // starts immediately
run(agentB, input) // starts immediately, runs in parallel
```

`send()` queues input into the active turn if one exists, or creates a new turn. If the active turn is already aborted, input targets the next scheduled turn.

## Interrupt vs abort vs clear vs remove

| Method | Clears queue | Resets input history |
|--------|--------------|---------------------|
| `interrupt(reason)` | No | No |
| `abort(reason)` | No | No |
| `clear()` | Yes | Yes |
| `remove()` | Yes | Yes |

**Interrupt** aborts the active turn. The queue continues.

```ts
agent.interrupt('user interrupted')
```

**Abort** stops the running turn without recording a boundary.

```ts
agent.abort('user cancelled')
```

**Clear** aborts the running turn, removes queued turns, and resets the input history to the original `input`. The running turn emits `turn.aborted` with reason `cleared`.

```ts
agent.clear()
```

**Remove** aborts active work, removes queued turns, and clears the agent. After removal, the agent handle is no longer usable.

```ts
await agent.remove()
```

## State

Agent `state` is a plain object that plugins and instructions can read and write.

```ts
const agent = createAgent({
  instructions: state => `You are helping ${state.userId ?? 'a user'}.`,
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  state: { userId: 'user_123' },
})
```

`state` is shared across all turns on the same agent. Use it for context that should persist across the agent's lifetime.
