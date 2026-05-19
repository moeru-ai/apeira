# Packages

## apeira

`apeira` is the top-level package. It currently re-exports everything from
`@apeira/core`.

```ts
import { createAgent } from 'apeira'
```

Use this package when you want the default public entry point.

## @apeira/core

`@apeira/core` contains the stream-first agent runtime.

```ts
import { createAgent } from '@apeira/core'
```

It provides:

- `createAgent()`
- lifecycle events
- per-turn `ReadableStream` support through `run()`
- fire-and-forget submission through `send()`
- global subscriptions
- abort and clear behavior
- in-memory history

## @apeira/plugin-skills

`@apeira/plugin-skills` exposes filesystem-agnostic Skills primitives for Apeira
plugins and host applications.

```ts
import { createSkillsRegistry, skills } from '@apeira/plugin-skills'
```

It provides:

- a `skills()` plugin that injects model-visible skill metadata
- a host-owned `SkillsRegistry`
- formatting helpers for available-skill prompts and explicit skill invocation
- no direct filesystem access; applications own loading skill files
