# Agent Lifecycle

An Apeira agent keeps an in-memory history and runs submitted turns one at a
time.

## History

Each agent starts with the optional `input` passed to `createAgent()`.

When a turn starts, Apeira appends the new input item to the current history and
passes that full input state to `@xsai-ext/responses`.

When the turn completes successfully, Apeira commits the returned input state as
the next history.

```ts
const agent = createAgent({
  input: [
    {
      content: 'You have already introduced yourself.',
      role: 'user',
      type: 'message',
    },
  ],
  instructions: 'You are a concise assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})
```

## Queueing

Top-level turns submitted with `run()` are serialized. If `run()` is called while
another turn is running, the new turn waits until the running turn finishes.

```ts
const first = agent.run({
  content: 'First turn.',
  role: 'user',
  type: 'message',
})

const second = agent.run({
  content: 'Second turn.',
  role: 'user',
  type: 'message',
})
```

`second` will not start until `first` is done, failed, or aborted.

`send()` is a fire-and-forget input entrypoint. If no turn is active or
scheduled, it creates a new top-level turn. If a turn is already active or
scheduled, the input is queued for that turn and drained after the current model
response completes.

## Clear

`clear()` aborts the running turn, clears queued turns, and resets in-memory
history to the original `input`.

```ts
agent.clear()
```

The running turn emits `turn.aborted` with the reason `cleared`.

Queued turns are removed before they start.

## Context

`context` is stored on the agent and can be read with `getContext()`.

```ts
const agent = createAgent({
  context: {
    userId: 'user_123',
  },
  instructions: context => `You are helping ${context.userId}.`,
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
})

const context = agent.getContext()
```

The current core does not automatically pass this context into xsAI tool
execution. Tool execution context is planned as a runtime extension point.
