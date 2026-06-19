# AgentChannel

`AgentChannel` is the typed event bus that every agent exposes. It is the only way plugins and user code communicate with the agent and with each other.

## Interface

```ts
interface AgentChannel {
  emit: <K extends string>(
    channel: K,
    event: K extends keyof AgentCustomEvent ? AgentCustomEvent[K] : unknown,
    options?: { save?: boolean },
  ) => MaybePromise<void>

  subscribe: <K extends string>(
    channel: K,
    listener: K extends keyof AgentCustomEvent
      ? AgentEventListener<AgentCustomEvent[K]>
      : AgentEventListener,
  ) => () => void
}
```

- `emit(channel, event, options?)` — emits an event on a named channel.
- `subscribe(channel, listener)` — registers a listener. Returns an unsubscribe function.

## The `'apeira'` channel

The built-in channel `'apeira'` carries all core lifecycle and runner forwarding events. Every event includes a `turnId`.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.subscribe('apeira', (event) => {
  console.log(event.turnId, event.type)
})
```

## Persisting events

Pass `{ save: true }` to persist the event to storage as an `event` entry. This is how the core turn lifecycle events are recorded.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

await agent.emit('apeira', {
  turnId: crypto.randomUUID(),
  type: 'agent.reset',
}, { save: true })
```

Listener errors are silently ignored so that one broken subscriber cannot break event delivery to others.

## Typed custom channels

Plugins can declare custom channels by extending `AgentCustomEvent`. Once declared, `subscribe()` infers the event type automatically.

```ts
import type { AGUIEvent } from '@ag-ui/core'

declare module '@apeira/core' {
  interface AgentCustomEvent {
    'ag-ui': AGUIEvent
  }
}
```

Custom channels are also how plugins talk to each other during `init()`:

```ts
const pluginA = {
  init: (agent) => {
    agent.subscribe('custom-channel', (event) => {
      // handle event from plugin-b
    })
  },
  name: 'plugin-a',
}

const pluginB = {
  init: (agent) => {
    agent.emit('custom-channel', { ok: true })
  },
  name: 'plugin-b',
}
```

## Design notes

- Channels are stored in a `Map<string, Set<AgentEventListener>>`.
- `emit()` resolves listeners and optional persistence in parallel with `Promise.all`.
- Subscriptions are removed lazily: when the last listener unsubscribes, the channel entry is deleted.
