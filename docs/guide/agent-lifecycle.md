# Agent Lifecycle

An Apeira agent owns one or more sessions. Each session keeps an append-only Episodic log and runs submitted turns one at a time.

## Episodic history

The default session starts with the optional `input` passed to `createAgent()`. Explicit sessions can also receive their own initial `input`.

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
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})
```

Initial `input` is appended to the session's Episodic log. When a turn starts, Apeira forks that log into a working copy, appends the new input, assembles model input, and forwards it to `@xsai-ext/responses`. On success, only the new working episodes are merged back into the committed log. On failure or abort, the working log is discarded.

## Queueing

Top-level turns on the same session are serialized. If `run()` is called while another turn is running, the new turn waits until the running turn finishes.

```ts
const first = agent.run(input)
const second = agent.run(input) // waits for first
```

Different sessions can run concurrently:

```ts
const sessionA = agent.session({ id: 'a' })
const sessionB = agent.session({ id: 'b' })

sessionA.run(input) // starts immediately
sessionB.run(input) // starts immediately
```

`send()` queues input into the active turn if one exists, or creates a new turn. If the active turn is already aborted, input targets the next scheduled turn.

## Interrupt vs abort vs clear vs remove

| Method | Records boundary | Clears queue | Resets Episodic | Deletes session |
|--------|-----------------|--------------|----------------|-----------------|
| `interrupt(reason)` | Yes | No | No | No |
| `abort(reason)` | No | No | No | No |
| `clear()` | No | Yes | Yes | No |
| `remove()` | No | Yes | Yes | Yes |

**Interrupt** aborts the active turn and appends an `interrupt` boundary visible to the model on the next turn. The queue continues.

```ts
agent.interrupt('user interrupted')
```

**Abort** stops the running turn without recording a boundary.

```ts
agent.abort('user cancelled')
```

**Clear** aborts the running turn, removes queued turns, and resets the Episodic log to the original `input`. The running turn emits `turn.aborted` with reason `cleared`.

```ts
agent.clear()
```

**Remove** is available on explicit sessions. It aborts active work, removes queued turns, deletes persisted session state, and closes the old session handle.

```ts
await session.remove()
```

## Context

Agent context is a three-layer merge: **agent context**, then **session context**, then **run context**. Later layers override earlier fields.

```ts
const agent = createAgent({
  context: { locale: 'en-US', userId: 'user_123' },
  instructions: ctx => `You are helping ${ctx.userId}.`,
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})

agent.setContext({ locale: 'zh-CN' })

const session = agent.session({
  context: { userId: 'user_456' },
})

session.setContext({ locale: 'en-US' })

// run context is transient
session.run(input, { context: { requestId: 'req_123' } })
```

The effective context for a turn is `merge(agentContext, sessionContext, runContext)`. Instructions receive the merged context and can adapt the system prompt dynamically.

For more on session-level context, see [Sessions](/guide/sessions).


