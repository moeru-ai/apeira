# Core API

The core API is exported from both `apeira` and `@apeira/core`.

```ts
import { createAgent } from 'apeira'
// or
import { createAgent } from '@apeira/core'
```

## createAgent()

```ts
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

### Options

```ts
interface CreateAgentOptions<T> {
  context?: AgentContext<T>
  input?: ItemParam[]
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  name: string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  plugins?: AgentPlugin[]
}
```

`options` are xsAI response options. Apeira owns the input state, instructions, and abort signal for each turn.
`input` seeds the default session's Episodic log.

## Agent

Agent methods operate as if on the default session (id = `'default'`) unless a session is explicitly created.

### run()

Submits a turn and returns a `ReadableStream` of events for that turn.

```ts
const stream = agent.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

The stream closes after `turn.done`, `turn.failed`, or `turn.aborted`.

Pass run options with a transient context overlay or `AbortSignal`:

```ts
agent.run(input, {
  context: { requestId: 'req_123' },
  signal,
})
```

### send()

Submits input and returns a turn ID immediately.

```ts
const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

If no turn is active or scheduled, a new top-level turn is created. If a turn is active or scheduled, input is queued for that turn and the returned ID is the existing turn ID. If the active turn is already aborted, input targets the next scheduled turn.

### interrupt()

Interrupts the active turn and records a model-visible boundary.

```ts
agent.interrupt('user interrupted')
```

### abort()

Aborts the currently running turn without recording a boundary.

```ts
agent.abort('user cancelled')
```

### clear()

Aborts the running turn, clears queued turns, and resets the default session's Episodic log to the original `input`.

```ts
agent.clear()
```

### session()

Creates or addresses an explicit session. Each session has its own queue, interrupt state, Episodic log, and context overlay.

```ts
const session = agent.session({ context: { userId: 'user_123' }, id: 'conversation-1' })

session.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

Calling `session()` with an existing `id` returns that session and merges the provided context. The `input` option only applies when creating a new session.

```ts
interface SessionOptions<T> {
  context?: Partial<AgentContext<T>>
  episodic?: string
  id?: string
  input?: ItemParam[]
}
```

Use `episodic` to restore a session from a previously saved JSONL string. Use `input` only to seed a new log from raw items.
If both are provided when creating a session, `episodic` is the restored log and `input` is ignored.

For a full guide, see [Sessions](/guide/sessions).

### setContext()

Updates context at the agent or session level. Context is merged as a partial overlay.

```ts
agent.setContext({ locale: 'en-US', product: 'docs' })

session.setContext({ locale: 'zh-CN' })
```

### getContext()

Returns the merged agent context.

```ts
const context = agent.getContext()
```

### subscribe('apeira')

Subscribes to all core events from the agent.

```ts
const unsubscribe = agent.subscribe('apeira', event =>
  console.log(event.turnId, event.type))
```

Returns a function that removes the listener and returns whether it was present.

## AgentSession

Session methods operate on a single isolated conversation. See [Sessions](/guide/sessions) for usage.

### fork()

Creates a new session from the committed Episodic log and session context of an existing session.

```ts
const forked = await session.fork({
  context: { locale: 'zh-CN' },
  id: 'conversation-1-draft',
})
```

If the source session has an active turn, only already committed episodes are copied. Passing an existing target `id` throws.

## Episodic exports

Core also exports the Episodic types and helpers:

```ts
import type { Episode, Episodic, EpisodicQuery, SessionState } from '@apeira/core'

import {
  createEpisodic

} from '@apeira/core'
```

The persisted session state shape is:

```ts
interface SessionState<T = unknown> {
  context: Partial<AgentContext<T>>
  episodic: string
  version: number
}
```

For behavior details, see [Episodic](/guide/episodic).

### remove()

Deletes an explicit session from memory and storage.

```ts
await session.remove()
```

The default session cannot be removed. Removed handles reject later method calls; calling `agent.session({ id })` after removal creates a fresh session.
