# @apeira/plugin-compact

Automatic context compaction for long-running Apeira agents.

The compact plugin watches model usage and compresses older conversation history before the next turn when the context is near its configured limit. Recent turns are preserved verbatim, selected older user messages are kept as anchors, and the remaining older history is summarized by a temporary Apeira agent.

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

When using `@apeira/session`, pass the plugin's boundary predicate to the
session. Compaction then keeps the original branch history and exposes only the
latest compacted context to the agent:

```ts
import { mem } from '@apeira/core'
import { isCompaction } from '@apeira/plugin-compact'
import { createSession } from '@apeira/session'

const session = createSession({
  defaultRef: 'main',
  isCompaction,
  sessionStorage: mem(),
})
```

`compactAgent.runner` optionally configures the backend used for summarization. It can use a smaller or cheaper model than the main agent. When omitted, the plugin reuses the parent agent's runner.

## How it works

The plugin uses two lifecycle hooks:

- `onFinish` reads `usage.totalTokens`. When usage crosses `state.contextLength * threshold`, the next turn is scheduled for compaction.
- `prepareStep` runs before the next model step. On the first step of the turn, it compacts historical input and leaves the current turn's live input untouched.

The compacted history is assembled as:

1. retained older user messages
2. a `<context_summary>` developer message
3. the most recent preserved turns, kept verbatim

If usage is unavailable, `prepareStep` falls back to a lightweight JSON byte estimate for the input.

## API

### `compact(options)`

Creates an Apeira plugin that automatically replaces old agent input with a compacted version.

```ts
interface CompactPluginOptions {
  compactAgent: {
    instructions?: CreateAgentOptions['instructions']
    runner?: Runner
  }
  maxRetainedUserTokens?: number
  preserveTurns?: number
  threshold?: number
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `compactAgent` | `{ instructions?, runner }` | — | Temporary agent configuration used to generate summaries. |
| `maxRetainedUserTokens` | `number` | `8192` | Approximate token budget for older user messages kept outside the summary. |
| `preserveTurns` | `number` | `2` | Number of most recent user turns to keep verbatim. |
| `threshold` | `number` | `0.9` | Compaction threshold as a fraction of `state.contextLength`. |

Set the context window on the agent state:

```ts
createAgent({
  // ...
  initialState: { contextLength: 128_000 },
})
```

If `state.contextLength` is not set, the plugin falls back to `128000`.

## Failure behavior

If the summary request fails or returns an empty/refusal response, the plugin keeps the existing history and retries on later turns. After three consecutive failures, it falls back to hard truncation:

```json
{
  "type": "message",
  "role": "developer",
  "content": "(Earlier conversation omitted due to length)"
}
```

When the preserved recent turns alone are too large, the plugin reduces the preserved turn count before falling back to a minimal truncation.

## Notes

- The temporary summary agent is created without plugins, so compaction cannot recursively compact itself.
- Compaction appends a durable `compact/boundary` entry followed by the summary,
  preserved recent input, and current state. A session configured with
  `isCompaction` hides entries before the latest boundary from model context
  without deleting the original history.
- Token counting uses a cheap heuristic based on `JSON.stringify(input).length / 4`; it intentionally avoids tokenizer dependencies.
