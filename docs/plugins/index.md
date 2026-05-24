# Plugins

Plugins extend the agent lifecycle through a simple hook interface. Every feature beyond the core runtime — skills, storage, UI bridges — is a plugin.

## Plugin interface

A plugin is an object that conforms to `AgentPlugin`:

```ts
interface AgentPlugin {
  enforce?: 'post' | 'pre'
  extendInstructions?: (context: AgentContext<unknown>) => MaybePromise<string | undefined>
  onEvent?: (event: AgentEvent) => void
  onFinish?: (...args: unknown[]) => MaybePromise<unknown>
  onSessionInit?: (session: { id: string }) => MaybePromise<void>
  onStepFinish?: (...args: unknown[]) => MaybePromise<unknown>
  onTurnDone?: (event: { sessionId: string, turnId: string }) => MaybePromise<void>
  onTurnStart?: (event: { sessionId: string, turnId: string }) => MaybePromise<void>
  prepareStep?: (...args: unknown[]) => MaybePromise<unknown>
  resolveTools?: (context: { sessionId: string }) => MaybePromise<Tool[] | undefined>
  setup?: (api: AgentPluginApi) => MaybePromise<void>
  storage?: {
    getItem: (key: string) => MaybePromise<string | undefined>
    removeItem: (key: string) => MaybePromise<void>
    setItem: (key: string, value: string) => MaybePromise<void>
  }
}
```

### Lifecycle hooks

- `setup(api)` — called when the plugin is registered. Use `api.emit()` and `api.subscribe()` for custom channels. See [Channels](#channels) below.
- `onSessionInit` — called when a session is first accessed.
- `onTurnStart` / `onTurnDone` — called at the beginning and end of each turn.
- `onEvent` — observe all agent events.

### Instruction and tool hooks

- `extendInstructions` — append content to the system prompt. Receives the merged context.
- `resolveTools` — inject tools into model calls for a session.
- `onFinish`, `onStepFinish`, `prepareStep` — pass-through hooks to xsAI response lifecycle.

### Storage

Plugins can provide a `storage` object with `getItem`, `setItem`, and `removeItem`. When present, session state (context + history + version) is serialized to JSON and persisted. Optimistic concurrency via a version counter prevents conflicting writes.

### Ordering

Set `enforce: 'pre'` to run a hook before other plugins, or `enforce: 'post'` to run after. Default order is registration order.

## Using plugins

```ts
import { skills } from '@apeira/plugin-skills'
import { createAgent } from 'apeira'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [
    skills({
      sets: [mySkillSet],
    }),
  ],
})
```

## Available plugins

| Package | Description |
|---------|-------------|
| `@apeira/plugin-common-tools` | Common development tools (read, write, edit, bash, fetch, search). See [Common Tools](/plugins/common-tools). |
| `@apeira/plugin-mcp` | Model Context Protocol integration. See [MCP](/plugins/mcp). |
| `@apeira/plugin-skills` | Filesystem-agnostic skills system. See [Skills](/plugins/skills). |
| `@apeira/plugin-ag-ui` | Bridges Apeira events to `@ag-ui/core` format. See [AG-UI](/plugins/ag-ui). |
| `@apeira/plugin-unstorage` | Wraps `unstorage` for session persistence. See [Unstorage](/plugins/unstorage). |

## Building a custom plugin

```ts
import type { AgentPlugin } from '@apeira/core'

const loggingPlugin: AgentPlugin = {
  name: 'logging',
  onEvent: event => event.type === 'turn.failed' && console.error(event.error),
  onTurnDone: ({ turnId }) => console.log('turn finished:', turnId),
  onTurnStart: ({ turnId }) => console.log('turn started:', turnId),
}
```

Register it by passing it in the `plugins` array to `createAgent()`.

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

- [Skills](/plugins/skills) — read about the skills plugin.
- [AG-UI](/plugins/ag-ui) — bridge events to AG-UI frontends.
- [Unstorage](/plugins/unstorage) — persist sessions with unstorage.
