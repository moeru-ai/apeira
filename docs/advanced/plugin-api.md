# Plugin API

Plugins extend the agent lifecycle through a simple hook interface. Every feature beyond the core runtime — skills, storage, UI bridges — is a plugin.

## Plugin interface

A plugin is an object that conforms to `AgentPlugin`:

```ts
interface AgentPlugin {
  enforce?: 'post' | 'pre'
  extendInput?: (options: ExtendInputOptions) => MaybePromise<ItemParam[] | void>
  extendInstructions?: (options: ExtendInstructionsOptions) => MaybePromise<string | void>
  onEvent?: (event: AgentEvent) => void
  onFinish?: ResponsesOptions['onFinish']
  onSessionInit?: (options: SessionInitOptions) => MaybePromise<void>
  onStepFinish?: ResponsesOptions['onStepFinish']
  onTurnDone?: (options: TurnDoneOptions) => MaybePromise<void>
  onTurnStart?: (options: TurnStartOptions) => MaybePromise<void>
  prepareStep?: ResponsesOptions['prepareStep']
  resolveTools?: (options: ResolveToolsOptions) => MaybePromise<Tool[] | void>
  setup?: (api: AgentPluginApi) => MaybePromise<void>
  storage?: {
    getItem: (key: string) => MaybePromise<null | string | undefined>
    removeItem: (key: string) => MaybePromise<void>
    setItem: (key: string, value: string) => MaybePromise<void>
  }
}

interface ExtendInputOptions extends PluginHookBase {
  episodic: Episodic
  input: readonly ItemParam[]
  turnInput: ItemParam
}

interface ExtendInstructionsOptions extends PluginHookBase {
  turnInput: ItemParam
}

interface PluginHookBase {
  agentName: string
  context: AgentContext<unknown>
  sessionId: string
  signal: AbortSignal
  turnId: string
}
```

### Lifecycle hooks

- `setup(api)` — called when the plugin is registered. Use `api.emit()` and `api.subscribe()` for custom channels. See [Channels](#channels) below.
- `onSessionInit` — called when a session is first accessed.
- `onTurnStart` / `onTurnDone` — called at the beginning and end of each turn.
- `onEvent` — observe all agent events.

### Instruction and tool hooks

- `extendInstructions` — append content to the system prompt. Receives the merged context and current `turnInput`.
- `extendInput` — append temporary model input items for the next model call. This is the hook that receives the working `episodic` log. Returned items are not persisted unless the plugin appends episodes itself.
- `resolveTools` — inject tools into model calls for a session.
- `onFinish`, `onStepFinish`, `prepareStep` — pass-through hooks to xsAI response lifecycle.

```ts
const journalPlugin: AgentPlugin = {
  extendInput: () => [
    {
      content: 'User prefers concise answers.',
      role: 'user',
      type: 'message',
    },
  ],
  name: 'journal',
}
```

### Storage

Plugins can provide a `storage` object with `getItem`, `setItem`, and `removeItem`. When present, session state (`context` + `episodic` JSONL) is serialized to JSON and persisted.

### Ordering

Set `enforce: 'pre'` to run a hook before other plugins, or `enforce: 'post'` to run after. Default order is registration order.

## Channels

Plugins communicate with the outside world through named channels. The `AgentPluginApi` passed to `setup()` exposes `emit` and `subscribe` for this purpose.

- `api.emit(channel, event)` — emit an event on a named channel
- `api.subscribe(channel, listener)` — listen for events on a named channel

Known channels (like `'apeira'`) provide typed events; unknown channels fall back to `unknown`.

The built-in channel `'apeira'` carries all core agent lifecycle and model streaming events.

### Declaring a typed channel

If your plugin emits events on a custom channel, use `declare module` to register it in `AgentChannelMap`. This lets consumers get typed events when they `subscribe` to your channel.

```ts
import type { AGUIEvent } from '@ag-ui/core'

declare module '@apeira/core' {
  interface AgentChannelMap {
    'ag-ui': AGUIEvent
  }
}
```

Once declared, `agent.subscribe('ag-ui', event => ...)` infers `event` as `AGUIEvent` — no manual casting needed.

### Internal plugin communication

Plugins can also use `api.subscribe()` and `api.emit()` to communicate with each other during `setup()`:

```ts
const pluginA: AgentPlugin = {
  name: 'plugin-a',
  setup: (api) => {
    api.subscribe('custom-channel', (event) => {
      // handle event from other plugins
    })
  },
}

const pluginB: AgentPlugin = {
  name: 'plugin-b',
  setup: (api) => {
    api.emit('custom-channel', { ok: true })
  },
}
```

## Next steps

- [Plugins](/plugins/) — available plugins and quick-start.
- [Episodic](/advanced/episodic) — advanced session history API.
