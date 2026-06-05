# Plugin API

Plugins extend the agent lifecycle through a simple hook interface. Every feature beyond the core runtime — skills, storage, UI bridges — is a plugin.

## Plugin interface

A plugin is an object that conforms to `AgentPlugin`:

```ts
interface AgentPlugin {
  enforce?: 'post' | 'pre'
  extendInstructions?: (options: ExtendOptions) => MaybePromise<string | void>
  extendTools?: (options: ExtendOptions) => MaybePromise<Tool[] | void>
  init?: (agent: Agent) => MaybePromise<void>
  name: string
  onFinish?: ResponsesOptions['onFinish']
  onStepFinish?: ResponsesOptions['onStepFinish']
  postToolCall?: ResponsesOptions['postToolCall']
  prepareStep?: ResponsesOptions['prepareStep']
  preToolCall?: ResponsesOptions['preToolCall']
  stop?: () => MaybePromise<void>
  version?: string
}

interface ExtendOptions {
  signal?: AbortSignal
  state: AgentState
  turnId: string
}
```

### Lifecycle hooks

- `init(agent)` — called before the first turn runs. Use `agent.subscribe()` and `agent.emit()` for custom channels. See [Channels](#channels) below.
- `stop()` — called when the agent is stopped or removed. Use it to clean up resources.

### Instruction and tool hooks

- `extendInstructions` — append content to the system prompt. Receives the agent `state`, the turn's `turnId`, and an optional `signal` for cancellation.
- `extendTools` — inject tools into model calls. Receives the same `ExtendOptions` as `extendInstructions`.
- `onFinish`, `onStepFinish`, `prepareStep`, `preToolCall`, `postToolCall` — pass-through hooks to xsAI response lifecycle.
  - `preToolCall` — called before a tool is executed. Return a modified tool call or a tool result to short-circuit execution. The first plugin to return a non-empty value wins.
  - `postToolCall` — called after a tool is executed. Return a modified tool result to override the output. The first plugin to return a non-empty value wins.

```ts
const journalPlugin: AgentPlugin = {
  extendInstructions: () => 'User prefers concise answers.',
  name: 'journal',
}
```

### Ordering

Set `enforce: 'pre'` to run a hook before other plugins, or `enforce: 'post'` to run after. Default order is registration order.

## Channels

Plugins communicate with the outside world through named channels on the agent itself.

- `agent.emit(channel, event)` — emit an event on a named channel
- `agent.subscribe(channel, listener)` — listen for events on a named channel

Known channels (like `'apeira'`) provide typed events; unknown channels fall back to `unknown`.

The built-in channel `'apeira'` carries all core agent lifecycle and model streaming events.

### Declaring a typed channel

If your plugin emits events on a custom channel, use `declare module` to register it in `AgentCustomEvent`. This lets consumers get typed events when they `subscribe` to your channel.

```ts
import type { AGUIEvent } from '@ag-ui/core'

declare module '@apeira/core' {
  interface AgentCustomEvent {
    'ag-ui': AGUIEvent
  }
}
```

Once declared, `agent.subscribe('ag-ui', event => ...)` infers `event` as `AGUIEvent` — no manual casting needed.

### Internal plugin communication

Plugins can also use `agent.subscribe()` and `agent.emit()` to communicate with each other during `init()`:

```ts
const pluginA: AgentPlugin = {
  init: (agent) => {
    agent.subscribe('custom-channel', (event) => {
      // handle event from other plugins
    })
  },
  name: 'plugin-a',
}

const pluginB: AgentPlugin = {
  init: (agent) => {
    agent.emit('custom-channel', { ok: true })
  },
  name: 'plugin-b',
}
```
