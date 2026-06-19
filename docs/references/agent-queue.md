# AgentQueue

`AgentQueue` is the turn scheduler inside every agent. It serializes top-level turns, drains queued input into the active turn, and handles aborts and resets.

## Interface

```ts
interface AgentQueue {
  abort: (reason?: unknown) => void
  clear: () => Promise<void>
  getActiveTurnId: () => string | undefined
  interrupt: (reason?: unknown) => MaybePromise<string | undefined>
  isIdle: () => boolean
  send: (item: AgentInput, options?: AgentSignalOptions) => string
  wait: (options?: AgentSignalOptions) => Promise<void>
}
```

## Turn lifecycle

When you call `send()`, the queue either:

1. Enqueues a new top-level turn if no turn is active.
2. Appends the input to the active turn's pending input buffer and emits `turn.input_queued`.

The active turn loop:

1. Emits `turn.start`.
2. Calls the runner with the current input.
3. If new input was queued while the runner was running, drains it (`turn.input_drained`) and loops again with the drained input.
4. Emits `turn.done` on success, `turn.failed` on error, or `turn.aborted` if aborted.

This loop handles input submitted with `send()` while a turn is active. Tool execution and `stopWhen`-controlled multi-step model calls happen inside the runner, independently of the queue's pending-input drain.

## Queueing semantics

Top-level turns on the same agent run one at a time. Different agents run concurrently.

```ts twoslash
import { createAgent, run } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

const input = { content: 'Hello.', role: 'user', type: 'message' } as const

const first = run(agent, input)
const second = run(agent, input) // waits for first
```

`run()` builds a `ReadableStream` around `send()` and `subscribe()`, filtering events to the submitted turn.

## Abort and interrupt

- `abort(reason)` aborts the active turn without recording a boundary.
- `interrupt(reason)` aborts the active turn and lets the agent record a `<turn_aborted>` boundary in storage.
- `clear()` aborts the active turn and drops all queued turns and pending input. It is used by `reset()`.
- `wait()` returns a promise that resolves when the queue becomes idle.

```ts twoslash
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})

await agent.wait() // resolves when no turn is running
```

## Design notes

- Pending top-level turns are stored in a `yocto-queue`.
- Pending input for the active turn is kept in an in-memory array and drained after each runner call.
- `send()` is synchronous and returns immediately with a `crypto.randomUUID()` turn id.
- The queue uses an internal `pumping` flag so concurrent `send()` calls share the same pump loop.
