# AgentStateManager

`AgentStateManager` is the object returned as `agent.state`. It manages the agent's current state snapshot, applies patches, and coordinates persistence with storage.

## Interface

```ts
interface AgentStateManager {
  get: () => Readonly<AgentState>
  restore: (next: AgentState) => void
  set: (next: ((prev: Readonly<AgentState>) => AgentState) | AgentState) => void
  update: (next: Partial<AgentState>) => void
}
```

## Methods

### `get()`

Returns the current state snapshot as a readonly object.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const current = agent.state.get()
```

### `set(next)`

Replaces the current state. Accepts either a new state object or a function that receives the previous state and returns the next state.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.state.set({ userName: 'Bob' })
agent.state.set(prev => ({ ...prev, userName: 'Carol' }))
```

### `update(patch)`

Shallow-merges a partial state object into the current state.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.state.update({ userName: 'Bob' })
```

### `restore(next)`

Silently replaces the current state without triggering the persistence hook. It is used by `@apeira/session` to swap state when checking out a different branch without creating a new storage entry.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  initialState: { userName: 'Alice' },
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.state.restore({ userName: 'Carol' })
```

## Persistence hook

`createAgent()` wires the state manager to storage through an `onChange` callback. Every `set()` or `update()` appends a `state` entry to storage. `restore()` does not append an entry.

During `init()`, the manager loads the latest `state` entry from storage, falling back to `initialState`.

## Design notes

- The manager keeps a private clone of the state object. `get()` is readonly at the TypeScript type level; it is not frozen or cloned at runtime. Do not mutate the returned object. Use `set()` or `update()` so changes follow the supported persistence path.
- All writes use `structuredClone()` internally so mutations to the passed object do not affect the stored snapshot.
- The persistence hook is synchronous from the manager's perspective; `createAgent()` wraps it in an async storage append.

See [State](/guide/state) for user-facing patterns: dynamic instructions, plugin usage, and extending `AgentState`.
