# @apeira/session

Tree-shaped durable session history for Apeira agents.

## Usage

```ts
import { createAgent, mem } from '@apeira/core'
import { createSession } from '@apeira/session'

const session = createSession({
  defaultRef: 'main',
  sessionStorage: mem(),
})

const agent = createAgent({
  // ...
  storage: session.storage,
})
```

`session.sessionStorage` contains the complete append-only log.
`session.storage` is the active branch view used by core.

## Branches

```ts
await session.fork('experiment')
await session.checkout('main')
await session.rebase('experiment', 'main')

const input = await session.buildInput('experiment')
const state = await session.buildState('experiment')
```

Strings resolve as refs first, then entry ids. `checkout()` without a target
creates a detached empty context.

## Custom semantic entries

Every entry except lifecycle events and session control entries is a semantic
branch node. Plugin-defined entries receive `parentId`, advance the active
branch, and are preserved by path, rebase, and clone operations without
session-specific configuration.

For example, `@apeira/plugin-compact` works directly with session storage:

```ts
const agent = createAgent({
  // ...
  plugins: [compact({ compactAgent: { runner: summaryRunner } })],
  storage: session.storage,
})
```

Session stores the compact entry as an ordinary semantic node. The plugin owns
how that entry is projected into model context.
