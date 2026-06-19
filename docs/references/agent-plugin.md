# AgentPlugin

`AgentPlugin` is the hook interface used to extend the agent lifecycle. It powers optional capabilities such as skills, compaction, tool approval, MCP integration, and UI bridges. Runners and storage backends use separate extension points.

## Interface

```ts
interface AgentPlugin {
  enforce?: 'post' | 'pre'
  extendInstructions?: (options: ExtendOptions) => MaybePromise<string | void>
  extendTools?: (options: ExtendOptions) => MaybePromise<Tool[] | void>
  init?: (agent: Agent) => MaybePromise<void>
  name: string
  onFinish?: (step?: CompletionStep) => MaybePromise<unknown>
  onStepFinish?: (step: CompletionStep) => MaybePromise<unknown>
  onTurnFinish?: (options: TurnFinishOptions) => MaybePromise<void>
  postToolCall?: PostToolCall
  prepareStep?: PrepareStep<AgentInput[], unknown>
  preToolCall?: PreToolCall
  stop?: () => MaybePromise<void>
  transformEntries?: (
    entries: readonly AgentEntry[],
    options: TransformEntriesOptions,
  ) => MaybePromise<readonly AgentEntry[]>
  version?: string
}

interface ExtendOptions {
  signal?: AbortSignal
  state: AgentState
  turnId: string
}
```

## Lifecycle hooks

### `init(agent)`

Called before the first turn runs. Use `agent.subscribe()` and `agent.emit()` for custom channels. See [AgentChannel](/references/agent-channel) for details.

### `stop()`

Called when the agent is stopped. Use it to clean up resources.

## Instruction and tool hooks

### `extendInstructions`

Appends content to the system prompt. Receives the agent `state`, the turn's `turnId`, and an optional `signal` for cancellation.

### `extendTools`

Injects tools into model calls. Receives the same `ExtendOptions` as `extendInstructions`.

### `transformEntries`

Sequentially derives historical `AgentEntry[]` before core converts it with `toAgentInput()`. Current-turn live input is appended afterward and is not exposed to this hook.

### `onTurnFinish`

Runs once after a successful queued turn. Core persists and emits `turn.done` first, then awaits plugins sequentially before the next turn. It receives cumulative drained input/output and the final runner call's usage.

### `onFinish`, `onStepFinish`, `prepareStep`, `preToolCall`, `postToolCall`

Pass-through hooks to the xsAI response lifecycle.

- `preToolCall` — called before a tool is executed. Return a modified tool call or a tool result to short-circuit execution. The first plugin to return a non-empty value wins.
- `postToolCall` — called after a tool is executed. Return a modified tool result to override the output. The first plugin to return a non-empty value wins.

```ts twoslash
import type { AgentPlugin } from '@apeira/core'

const journalPlugin: AgentPlugin = {
  extendInstructions: () => 'User prefers concise answers.',
  name: 'journal',
}
```

## Ordering

Set `enforce: 'pre'` to run a hook before other plugins, or `enforce: 'post'` to run after. Default order is registration order.

## Channels

Plugins communicate with the outside world through named channels on the agent itself.

- `agent.emit(channel, event)` — emit an event on a named channel.
- `agent.subscribe(channel, listener)` — listen for events on a named channel.

Known channels (like `'apeira'`) provide typed events; unknown channels fall back to `unknown`.

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

```ts twoslash
import type { AgentPlugin } from '@apeira/core'

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

## Design notes

- Plugins are plain objects. There is no base class to extend.
- Hooks are awaited in order; a slow plugin delays the next one in the chain.
- `enforce` only affects ordering within the hook pipeline, not execution timing relative to core.

See [Plugins](/plugins/) for available packages and usage patterns.
