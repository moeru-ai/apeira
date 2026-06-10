# Core API

The core API is exported from both `apeira` and `@apeira/core`.

```ts
import { chat, createAgent, responses, run } from 'apeira'
// or
import { chat, createAgent, responses, run } from '@apeira/core'
```

## createAgent()

```ts
const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

### Options

```ts
interface CreateAgentOptions {
  input?: AgentInput[]
  instructions: ((state: AgentState) => Promise<string> | string) | string
  plugins?: AgentPluginOption[]
  runner: Runner
  state?: AgentState
}
```

Use `responses(options)` for the Responses API or `chat(options)` for Chat Completions. Apeira owns the input state, instructions, and abort signal for each turn.
`input` seeds the agent's history.

```ts
const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: chat({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

## Agent

An agent is both an `AgentChannel` (event bus) and an `AgentQueue` (turn queue).

### init()

Initializes all plugins. Called automatically before the first turn runs; you only need to call it manually if you want to eager-initialize plugins.

```ts
await agent.init()
```

### stop()

Stops all plugins in reverse registration order.

```ts
await agent.stop()
```

### getInput()

Returns the accumulated input history (including user inputs and model outputs from completed turns).

```ts
const input = agent.getInput()
```

### getState()

Returns a cloned snapshot of the agent state.

```ts
const state = agent.getState()
```

### setInput()

Replaces the accumulated input history. This is primarily useful for plugins that manage history, such as context compaction.

```ts
agent.setInput(nextInput)
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

If a turn is active, input is queued for that turn and the returned ID is the
existing turn ID. If no turn is active, a new top-level turn is created.

### run()

`run()` is a free function (not an agent method) that submits a turn and returns a `ReadableStream` of events.

```ts
import { run } from 'apeira'

const stream = run(agent, {
  content: 'Say hello.',
  role: 'user',
  type: 'message',
})
```

The stream closes after `turn.done`, `turn.failed`, or `turn.aborted`.

Pass run options with an `AbortSignal`:

```ts
run(agent, input, { signal: controller.signal })
```

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

Aborts the running turn, clears queued turns, resets the input history to the original `input`, and resets `state` to its initial value.

```ts
agent.clear()
```

### subscribe('apeira')

Subscribes to all core events from the agent.

```ts
const unsubscribe = agent.subscribe('apeira', event =>
  console.log(event.turnId, event.type))
```

Returns a function that removes the listener.

### emit()

Emits an event on a named channel.

```ts
agent.emit('my-channel', { ok: true })
```

Plugins can declare typed channels via `declare module '@apeira/core'`.

## AgentChannel

```ts
interface AgentChannel {
  emit: <K extends string>(channel: K, event: K extends keyof AgentCustomEvent ? AgentCustomEvent[K] : unknown) => void
  subscribe: <K extends string>(channel: K, listener: K extends keyof AgentCustomEvent ? AgentEventListener<AgentCustomEvent[K]> : AgentEventListener) => () => void
}
```

## AgentQueue

```ts
interface AgentQueue {
  abort: (reason?: unknown) => void
  clear: () => void
  getActiveTurnId: () => string | undefined
  interrupt: (reason?: unknown) => string | undefined
  send: (item: AgentInput, options?: AgentSendOptions) => string
}
```
