# Sessions

Sessions isolate conversations within an agent. Each session has its own queue, interrupt state, Episodic log, and context overlay. Different sessions can run concurrently.

## Default session

The root agent methods (`run()`, `send()`, `interrupt()`, etc.) operate on a `'default'` session.

```ts
// these all use the default session
agent.run(input)
agent.send(input)
agent.interrupt('stop')
agent.clear()
```

## Explicit sessions

Use `agent.session()` to create or address a named session.

```ts
const session = agent.session({ id: 'conversation-1' })

session.run(input)
session.interrupt('need to redirect')
session.clear()
```

Calling `session()` with an existing `id` returns that session and merges the provided context. The `input` option only applies when creating a new session.

## Forking sessions

Use `session.fork()` to branch from the committed Episodic log and context of an existing session.

```ts
const draft = await session.fork({
  context: { locale: 'zh-CN' },
  id: 'conversation-1-draft',
})

draft.run(input)
```

Forked sessions are independent. They get their own queue, interrupt state, and Episodic log. Later turns on the source session do not affect the fork. If the source session has an active turn, the fork copies only episodes that have already been committed.

## Session isolation

Each session is fully isolated:

- **Queue** — turns are serialized within a session but concurrent across sessions
- **Episodic** — each session keeps its own append-only event log
- **Context** — session-level context is a partial overlay on top of agent-level context
- **Interrupt state** — interrupting one session does not affect others

```ts
const sessionA = agent.session({ id: 'a' })
const sessionB = agent.session({ id: 'b' })

sessionA.run(input) // starts immediately
sessionB.run(input) // starts immediately, runs in parallel
```

## Session context

Session context overlays agent context. The effective context for a turn is:

```
merge(agentContext, sessionContext, runContext)
```

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

const session = agent.session({
  context: { userId: 'user_456' },
})

session.setContext({ locale: 'zh-CN' })
```

## Session methods

Sessions expose conversation methods for one isolated session. See [Core API](/reference/core) for the full interface.

### run()

Submits a turn to this session and returns a `ReadableStream` of events.

```ts
const stream = session.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})

for await (const event of stream)
  console.log(event.turnId, event.type)
```

### send()

Fire-and-forget input submission. Returns the turn ID immediately.

```ts
const turnId = session.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

### interrupt()

Aborts the active turn in this session and records a model-visible boundary.

```ts
session.interrupt('user interrupted')
```

### abort()

Aborts the active turn without recording a boundary.

```ts
session.abort('user cancelled')
```

### clear()

Aborts the running turn, clears queued turns, and resets the Episodic log to the initial `input`.

```ts
session.clear()
```

### fork()

Creates a new session from this session's committed Episodic log and session-level context.

```ts
const forked = await session.fork({ id: 'variant-a' })
```

Pass `context` to overlay the copied session context. Passing an existing `id` throws.

### remove()

Deletes this explicit session from memory and storage.

```ts
await session.remove()
```

Removing a session aborts active work, aborts queued turns, and deletes persisted state. The default session cannot be removed. After removal, the old session handle rejects future method calls; use `agent.session({ id })` to create a fresh session with the same id.

### setContext() / getContext()

Update or read the session-level context overlay.

```ts
session.setContext({ locale: 'zh-CN' })
const ctx = session.getContext()
```

### subscribe('apeira')

Listen to all core events from this session (filtered to the session).

```ts
const unsubscribe = session.subscribe('apeira', event =>
  console.log(event.turnId, event.type))
```

## Persistence

When a storage plugin (e.g. `@apeira/plugin-unstorage`) is configured, session state — context and Episodic JSONL — is serialized to JSON and persisted.

Persisted state uses the current `episodic` JSONL field; old `items` history arrays are not migrated.

```ts
import fsDriver from 'unstorage/drivers/fs'

import { unstorage } from '@apeira/plugin-unstorage'
import { createStorage } from 'unstorage'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [
    unstorage({
      storage: createStorage({ driver: fsDriver({ base: './data' }) }),
    }),
  ],
})
```

## Next steps

- [Episodic](/guide/episodic) — advanced session history, boundaries, and persistence.
- [Agent Lifecycle](/guide/agent-lifecycle) — queueing, interrupt, abort, and clear.
- [Events](/guide/events) — understand the event system.
- [Plugins](/plugins/) — storage plugins and session persistence.
