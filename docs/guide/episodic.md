# Episodic

Episodic is Apeira's session history kernel. Each session stores an append-only JSONL log of episodes. A model call does not receive the raw log directly; Apeira assembles a Slice from the log for that turn.

## Core ideas

- **Episode** — one immutable event in a session log.
- **Episodic** — the append-only event stream for one session.
- **Slice** — the prompt view assembled from Episodic for a model call.
- **Boundary** — a structured marker such as `checkpoint`, `interrupt`, `overflow`, `intent`, or `segment`.
- **Meta** — audit data that is not sent to the model by default.

The log preserves raw facts. Trimming, normalization, and plugin contributions happen while building a Slice, not by editing old episodes.

## Episode types

```ts
type Episode = BoundaryEpisode | ItemEpisode | MetaEpisode
```

`item` episodes store raw xsAI `ItemParam` values:

```ts
episodic.appendItems([{
  content: 'Remember that the user prefers concise answers.',
  role: 'user',
  type: 'message',
}], {
  source: 'user',
  turnId,
})
```

`boundary` episodes mark explicit context boundaries:

```ts
episodic.append({
  meta: { source: 'runtime', turnId },
  payload: {
    content: 'The previous turn was interrupted; tools may have partially executed.',
    reason: 'interrupt',
    title: 'turn interrupted',
  },
  type: 'boundary',
})
```

`meta` episodes record audit information such as usage or parse errors:

```ts
episodic.append({
  meta: { source: 'runtime', turnId },
  payload: {
    data: { inputTokens: 120, outputTokens: 24, totalTokens: 144 },
    event: 'turn.usage',
  },
  type: 'meta',
})
```

## Querying

The `Episodic` API is exported from `@apeira/core`:

```ts
import { createEpisodic } from '@apeira/core'

const episodic = createEpisodic()
const recentItems = episodic.read({ limit: 12, type: 'item' })
```

`read()` has a safety default: with no query, it returns the latest 100 episodes. Add a query when you mean something else:

```ts
episodic.read() // latest 100
episodic.read({ fromId: 0 }) // full log
episodic.read({ limit: 6, type: 'item' })
episodic.read({ afterBoundary: 'checkpoint' })
episodic.read({ turnId })
```

`limit` is applied after filters. `limit: 0` returns an empty array.
`afterBoundary` returns episodes after the matching boundary, not including the boundary itself.

## Serialization

Session persistence stores JSON shaped like this:

```ts
interface SessionState<T = unknown> {
  context: Partial<AgentContext<T>>
  episodic: string
  version: number
}
```

`episodic` is JSONL. Use `toJSONL()` and `fromJSONL()` when a host wants to persist, inspect, or fork a log manually:

```ts
const jsonl = episodic.toJSONL()
const restored = createEpisodic(jsonl)
```

`fromJSONL()` skips bad lines and appends one `meta` episode with `event: 'error.parse'` if parse errors occurred.

Persisted state is a breaking format: current Apeira sessions use `episodic`, not the old `items` array.

## Turn isolation

Every turn runs against a working Episodic fork:

1. Apeira copies the committed session log.
2. The turn input and model output append to the working log.
3. On success, new working episodes merge into the session log.
4. On failure or abort, the working log is discarded.

`interrupt()` is the exception: it aborts the active turn and writes an `interrupt` boundary to the committed session log so the next turn can see that the previous turn was intentionally interrupted.

## Slice assembly

Slice is the prompt builder. It selects visible episodes, adds plugin contributions, and normalizes the final `ItemParam[]`. Slice assembly applies a coarse budget heuristic based on the previous turn's xsAI usage metadata: if the last known input tokens exceed the budget, it attempts to restart from the nearest `checkpoint` or `interrupt` boundary. If there is no such boundary, it keeps the current turn's episodes when a `turnId` is available; otherwise it returns no historical episodes.

Visible boundaries:

- `checkpoint`, `interrupt`, and `overflow` become model-visible messages.
- `intent` and `segment` remain audit/query boundaries and are not injected.

Normalize keeps function-call outputs paired with function calls. Orphan outputs are dropped. Tool outputs longer than 8,000 characters are shortened by keeping the first and last 4,000 characters with an omission marker in the middle.

## Plugins

Every plugin hook receives `episodic` in its hook base:

```ts
const plugin = {
  name: 'recent-items',
  onTurnStart: ({ episodic }) => {
    return {
      contributions: [{
        id: 'recent',
        items: episodic.read({ limit: 6, type: 'item' })
          .map(episode => episode.payload.item),
      }],
    }
  },
}
```

`onTurnStart` can also return Slice contributions:

```ts
const plugin = {
  name: 'journal',
  onTurnStart: () => ({
    contributions: [{
      id: 'journal',
      items: [{
        content: 'User prefers concise answers.',
        role: 'user',
        type: 'message',
      }],
    }],
  }),
}
```

Contributions affect only the assembled Slice. They do not mutate the session log unless the plugin explicitly appends episodes.

## Next steps

- [Sessions](/guide/sessions) — session isolation, forking, and persistence.
- [Agent Lifecycle](/guide/agent-lifecycle) — queueing, interrupt, abort, and clear.
- [Plugins](/plugins/) — hook into Episodic from plugins.
