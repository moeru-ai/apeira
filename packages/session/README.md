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

## Compaction

Compaction is an optional boundary supplied by another package:

```ts
import { isCompaction } from '@apeira/plugin-compact'

const session = createSession({
  defaultRef: 'main',
  isCompaction,
  sessionStorage: mem(),
})
```

The raw branch remains intact. Model-facing reads start at the latest applicable
boundary and include the compact summary and preserved recent input appended
after it.
