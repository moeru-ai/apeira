# Events

Apeira is event-driven. Every emitted event includes the `sessionId` and `turnId` of the turn it belongs to.

```ts
type AgentEvent = (ApeiraEvent | XSAIEvent) & {
  sessionId: string
  turnId: string
}
```

## Lifecycle events

Apeira emits these lifecycle events:

| Event | Payload | Description |
|-------|---------|-------------|
| `turn.queued` | — | A turn was queued waiting for a running turn to finish. |
| `turn.start` | — | A turn started execution. |
| `turn.input_queued` | — | Input was queued into the active turn. |
| `turn.input_drained` | `{ count }` | Queued input was drained and submitted to the model. |
| `turn.done` | — | The turn completed successfully. |
| `turn.failed` | `{ error }` | The turn failed with an error. |
| `turn.aborted` | `{ reason? }` | The turn was aborted. |

## xsAI forwarded events

Apeira forwards streaming events from `@xsai-ext/responses` and attaches the same `sessionId` and `turnId`. These include:

- `step.start` — a model reasoning step started.
- `step.done` — a step completed.
- `text.delta` — a text content delta.
- `reasoning.delta` — a reasoning content delta.
- `tool-call.start` — a tool call was invoked.
- `tool-call.done` — a tool call completed.

Use the `type` field to narrow the event you care about:

```ts
agent.subscribe('apeira', (event) => {
  if (event.type === 'turn.failed')
    console.error(event.error)

  if (event.type === 'text.delta')
    process.stdout.write(event.delta)
})
```

## Per-turn streams

`run()` returns a `ReadableStream` that is automatically filtered to the submitted turn.

```ts
const stream = agent.run(input)

for await (const event of stream) {
  if (event.type === 'turn.done')
    console.log('done')
}
```

The stream closes after `turn.done`, `turn.failed`, or `turn.aborted`.

## Global listeners

`subscribe('apeira', ...)` receives all core events from all sessions and turns.

```ts
const unsubscribe = agent.subscribe('apeira', event =>
  console.log(event.turnId, event.type))

unsubscribe()
```

The returned function removes the listener and returns whether it was present. Listener errors are silently ignored — one subscriber cannot break event delivery to others.

## Next steps

- [Sessions](/guide/sessions) — isolate conversations and observe per-session events.
- [Plugins](/plugins/) — hook into the event stream from plugins.
- [Core API](/reference/core) — full API reference.
