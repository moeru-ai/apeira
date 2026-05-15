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
}
```

`options` are xsAI response options. Apeira owns the input state, instructions,
and abort signal for each turn.

## Agent

```ts
interface Agent<T> {
  abort: (reason?: unknown) => void
  clear: () => void
  getContext: () => AgentContext<T>
  interrupt: (input: ItemParam, reason?: unknown, signal?: AbortSignal) => string
  run: (input: ItemParam, signal?: AbortSignal) => ReadableStream<AgentEvent>
  send: (input: ItemParam, signal?: AbortSignal) => string
  subscribe: (eventListener: AgentEventListener) => () => boolean
}
```

### run()

Submits a turn and returns a stream of events for that turn.

```ts
const stream = agent.run({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

The stream closes after `turn.done`, `turn.failed`, or `turn.aborted`.

### send()

Submits input and returns a turn id immediately.

```ts
const turnId = agent.send({
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

If no turn is active or scheduled, `send()` creates a new top-level turn. If a
turn is active or scheduled, the input is queued for that turn and the returned
id is the existing turn id.

If the active turn is already aborted, `send()` targets the next scheduled turn
instead. If no turn is scheduled, it creates a new turn.

Use `subscribe()` to observe progress.

### interrupt()

Interrupts the active turn with replacement input and returns the target turn id.

```ts
const turnId = agent.interrupt({
  content: 'Actually, answer this instead.',
  role: 'user',
  type: 'message',
}, 'user interrupted')
```

The active turn emits `turn.interrupted` and is aborted. The replacement input is
sent to the next scheduled turn or to a new turn. Pass an `AbortSignal` as the
third argument to make the replacement input cancelable.

### subscribe()

Subscribes to all events from the agent.

```ts
const unsubscribe = agent.subscribe(event =>
  console.log(event.turnId, event.type)
)
```

The returned function removes the listener and returns whether it was present.

### abort()

Aborts the currently running turn.

```ts
agent.abort('user cancelled')
```

### clear()

Aborts the running turn, clears queued turns, and resets in-memory history.

```ts
agent.clear()
```

### getContext()

Returns the agent context object.

```ts
const context = agent.getContext()
```

## Types

```ts
type AgentEvent = WithTurnId<ApeiraEvent | XSAIEvent>

type AgentEventListener = (event: AgentEvent) => unknown

type ItemParam = Exclude<ResponsesOptions['input'], string>[number]
```
