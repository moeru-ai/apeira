# @apeira/plugin-compact

Automatic context compaction for long-running Apeira agents.

The plugin appends a durable summary after a successful over-threshold turn.
Storage remains an append-only fact log; model context is derived from the
latest summary without storage-specific compaction support.

## Install

```sh
pnpm add @apeira/plugin-compact
```

## Usage

```ts
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { compact } from '@apeira/plugin-compact'

const agent = createAgent({
  initialState: {
    contextLength: 128_000,
  },
  instructions: 'You are a helpful assistant.',
  plugins: [
    compact({
      compactAgent: {
        runner: responses({
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: 'https://api.openai.com/v1/',
          model: 'gpt-5.5-mini',
        }),
      },
      threshold: 0.9,
    }),
  ],
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

`compactAgent.runner` may use a smaller or cheaper model than the main agent.
When omitted, the plugin reuses the parent agent runner.

The same configuration works with `@apeira/session`; no session adapter or
compaction predicate is required:

```ts
const session = createSession({
  defaultRef: 'main',
  sessionStorage: mem(),
})

const agent = createAgent({
  // ...
  plugins: [compact({ compactAgent: { runner: summaryRunner } })],
  storage: session.storage,
})
```

## How it works

- `onTurnFinish` checks the completed turn's final `usage.totalTokens`.
- Above the threshold, it reads raw storage, applies its own previous summary
  projection, asks the compact agent to summarize that input, and appends one
  `compact` entry containing `{ summary }`.
- On later turns, `transformEntries` replaces the latest `compact` entry with a
  temporary developer `<context_summary>` input and hides entries covered by
  that summary.
- Core appends current-turn live input after this historical projection, so the
  transform cannot inspect or modify it.

Original input, output, state, and lifecycle entries are never rewritten or
deleted.

## API

### `compact(options)`

```ts
interface CompactPluginOptions {
  compactAgent: {
    instructions?: CreateAgentOptions['instructions']
    runner?: Runner
  }
  threshold?: number
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `compactAgent` | `{ instructions?, runner? }` | — | Temporary agent configuration used to generate summaries. |
| `threshold` | `number` | `0.9` | Compaction threshold as a fraction of `state.contextLength`. |

Set the context window through agent state:

```ts
createAgent({
  // ...
  initialState: { contextLength: 128_000 },
})
```

If `state.contextLength` is absent, the plugin uses `128000`.

## Failure behavior

If summary generation fails, returns empty output, or is refused, the plugin
appends nothing and retries on later over-threshold turns. After three
consecutive failures, it appends this fallback as a compact summary:

```json
{
  "summary": "(Earlier conversation omitted due to length)"
}
```

## Notes

- The temporary summary agent has no plugins, so compaction cannot recursively
  compact itself.
- `turn.done` is emitted before summary generation, but the queue awaits
  `onTurnFinish` before starting the next turn.
- Summary generation reads raw storage plus compact's own previous-summary
  projection. Other plugins' `transformEntries` hooks are not applied.
