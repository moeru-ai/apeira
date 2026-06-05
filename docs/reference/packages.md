# Packages

## apeira

The umbrella package. Re-exports everything from `@apeira/core` and `@apeira/plugin-common-tools`.

```ts
import { commonTools, createAgent } from 'apeira'
```

Use this when you want the single default entry point.

## @apeira/core

The stream-first agent runtime.

```ts
import { createAgent, run } from '@apeira/core'
```

Provides:

- `createAgent()` and agent types
- lifecycle events
- per-turn `ReadableStream` support through `run()`
- fire-and-forget submission through `send()`
- global event subscriptions
- abort, interrupt, and clear behavior
- `init()` / `stop()` plugin lifecycle

## @apeira/plugin-compact

Automatic context compaction for long-running agents. See the [Compact plugin](/plugins/compact) guide.

```ts
import { compact } from '@apeira/plugin-compact'
```

Provides a `compact()` plugin that summarizes older conversation history with a temporary agent when context usage approaches a configured threshold.

## @apeira/plugin-skills

Filesystem-agnostic skills primitives for plugins and host applications. See the [Skills plugin](/plugins/skills) guide.

```ts
import { createSkillSet, skills } from '@apeira/plugin-skills'
```

Provides:

- a `skills()` plugin that injects model-visible skill metadata into instructions
- an optional `skill_reference` tool for reference files
- a host-owned `SkillSet` for managing skill definitions
- formatting helpers for available-skill prompts and explicit skill invocation
- a built-in `fsSkillSet` (`@apeira/plugin-skills/fs`) that reads skills from a directory
- no direct filesystem coupling — bring your own loader or use the built-in FS set

## @apeira/plugin-ag-ui

Bridges Apeira events to `@ag-ui/core` event format. See the [AG-UI plugin](/plugins/ag-ui) guide.

```ts
import { agui } from '@apeira/plugin-ag-ui'
```

Maps agent events (text messages, reasoning, tool calls, errors, run state) to the AG-UI protocol. Used by the CopilotKit example.
