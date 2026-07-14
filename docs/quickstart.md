# Quickstart

This guide walks you through building your first Apeira agent. You will install the package, create an agent, run a turn, consume the event stream, and handle interrupts.

## 1. Install

You can start with either the umbrella package or the runtime only.

- `apeira` — includes `@apeira/core`, `@apeira/session`, and `@apeira/storage` in a single dependency.
- `@apeira/core` — the runtime only. Storage, sessions, and UI bridges are added as separate packages.

::: code-group

```sh [apeira]
pnpm add apeira
npm install apeira
yarn add apeira
```

```sh [@apeira/core]
pnpm add @apeira/core
npm install @apeira/core
yarn add @apeira/core
```

:::

The rest of this guide imports from `@apeira/core`. If you installed `apeira`, change those imports to `apeira` — it re-exports the same members.

```diff
- import { createAgent } from '@apeira/core'
- import { responses } from '@apeira/core/responses'
+ import { createAgent, responses } from 'apeira'
```

## 2. Create an agent

An agent needs `instructions` and a `runner`. The runner decides which model API to call.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

## 3. Run a turn and print events

`run()` submits one user turn and returns a `ReadableStream` of events for that turn.

```ts twoslash
import { createAgent, run, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const stream = run(agent, user('Write a haiku about recursion in programming.'))

for await (const event of stream) {
  if (event.type === 'text.delta')
    process.stdout.write(event.delta)

  if (event.type === 'turn.done')
    console.log('\n[done]')
}
```

The stream emits model events (`text.delta`, `tool-call.start`, …) and lifecycle events (`turn.start`, `turn.done`). It closes after `turn.done`, `turn.failed`, or `turn.aborted`.

## 4. Fire-and-forget with subscribe and send

For long-running agents or UIs, subscribe to all events and submit turns with `send()`.

```ts twoslash
import { createAgent, user } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const unsubscribe = agent.subscribe('apeira', (event) => {
  if (event.type === 'text.delta')
    process.stdout.write(event.delta)

  if (event.type === 'turn.done')
    console.log('\n[done]')
})

agent.send(user('Say hello.'))

// later
unsubscribe()
```

`send()` returns a turn id immediately. If a turn is already active, the input is queued for that turn and the existing id is returned.

## 5. Interrupt, abort, and reset

- `interrupt(reason)` aborts the active turn and records a model-visible boundary.
- `abort(reason)` aborts without recording a boundary.
- `reset()` aborts, clears the queue and storage, and restores `initialInput` and `initialState`.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a concise assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

agent.interrupt('user interrupted')
```

See [Agent](/guide/agent) for the full picture.

## What's next?

- [Event](/guide/event) — lifecycle and streaming events.
- [Tools](/guide/tools) — configure agent tools or provide tools through plugins.
- [Runner](/guide/runner) — choose between `responses()` and `chat()`, use provider presets, or write a custom runner.
- [Plugins](/plugins/) — pre-built plugins for skills, HITL, MCP, compaction, AG-UI, and more.
- [AgentPlugin](/references/agent-plugin) — build your own plugin.
