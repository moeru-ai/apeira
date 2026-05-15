# Events

Apeira is event-driven. Every emitted event includes the `turnId` of the turn it
belongs to.

```ts
type AgentEvent = (ApeiraEvent | XSAIEvent) & {
  turnId: string
}
```

## Lifecycle events

Apeira emits these lifecycle events:

```ts
type ApeiraEvent
  = | { count: number, type: 'turn.input_drained' }
    | { error: unknown, type: 'turn.failed' }
    | { reason?: unknown, type: 'turn.aborted' }
    | { reason?: unknown, type: 'turn.interrupted' }
    | { type: 'turn.done' }
    | { type: 'turn.input_queued' }
    | { type: 'turn.queued' }
    | { type: 'turn.start' }
```

`turn.interrupted` is emitted before the interrupted turn is aborted. It marks a
user-level replacement input; the replacement input is processed by the next
queued turn or by a new turn.

## xsAI events

Apeira forwards streaming events from `@xsai-ext/responses` and attaches the
same `turnId`.

This includes events such as:

- `step.start`
- `step.done`
- model streaming events emitted by xsAI responses
- tool-related events emitted by xsAI responses

Use the event `type` field to narrow the event.

```ts
agent.subscribe((event) => {
  if (event.type === 'turn.failed')
    console.error(event.error)

  if (event.type === 'step.done')
    console.log(event.output)
})
```

## Per-turn streams

`run()` filters the global event stream to the submitted turn and returns it as a
`ReadableStream`.

```ts
const stream = agent.run({
  content: 'Hello.',
  role: 'user',
  type: 'message',
})

for await (const event of stream) {
  if (event.type === 'turn.done')
    console.log('done')
}
```

The stream closes after `turn.done`, `turn.failed`, or `turn.aborted`.

## Global subscriptions

`subscribe()` receives all agent events.

```ts
const unsubscribe = agent.subscribe(event =>
  console.log(event.turnId, event.type)
)

unsubscribe()
```

Listener errors are ignored so one subscriber cannot break event delivery to
other subscribers.
