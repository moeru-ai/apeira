# Plugins

Plugins extend the agent lifecycle through a simple hook interface. Every feature beyond the core runtime — skills, storage, UI bridges — is a plugin.

## Plugin interface

A plugin is an object that conforms to `AgentPlugin`:

```ts
interface AgentPlugin {
  enforce?: 'pre' | 'post'

  setup?(api: AgentPluginApi): MaybePromise<void>

  onSessionInit?(session: { id: string }): MaybePromise<void>

  onTurnStart?(event: { sessionId: string; turnId: string }): MaybePromise<void>
  onTurnDone?(event: { sessionId: string; turnId: string }): MaybePromise<void>

  onEvent?(event: AgentEvent): void

  extendInstructions?(context: AgentContext<unknown>): MaybePromise<string | undefined>

  resolveTools?(context: { sessionId: string }): MaybePromise<Tool[] | undefined>

  onFinish?(...args: unknown[]): MaybePromise<unknown>
  onStepFinish?(...args: unknown[]): MaybePromise<unknown>
  prepareStep?(...args: unknown[]): MaybePromise<unknown>

  storage?: {
    getItem(key: string): MaybePromise<string | undefined>
    setItem(key: string, value: string): MaybePromise<void>
    removeItem(key: string): MaybePromise<void>
  }
}
```

### Lifecycle hooks

- `setup(api)` — called when the plugin is registered. Use `api.emit()` and `api.subscribe()` for custom channels.
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
import { createAgent } from 'apeira'
import { skills } from '@apeira/plugin-skills'

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
| `@apeira/plugin-skills` | Filesystem-agnostic skills system. See [Skills](/plugins/skills). |
| `@apeira/plugin-ag-ui` | Bridges Apeira events to `@ag-ui/core` format. See [AG-UI](/plugins/ag-ui). |
| `@apeira/plugin-unstorage` | Wraps `unstorage` for session persistence. See [Unstorage](/plugins/unstorage). |

## Building a custom plugin

```ts
const loggingPlugin = {
  onTurnStart({ turnId }) {
    console.log('turn started:', turnId)
  },
  onTurnDone({ turnId }) {
    console.log('turn finished:', turnId)
  },
  onEvent(event) {
    if (event.type === 'turn.failed')
      console.error(event.error)
  },
}
```

Register it by passing it in the `plugins` array to `createAgent()`.

## Next steps

- [Skills](/plugins/skills) — read about the skills plugin.
- [AG-UI](/plugins/ag-ui) — bridge events to AG-UI frontends.
- [Unstorage](/plugins/unstorage) — persist sessions with unstorage.
