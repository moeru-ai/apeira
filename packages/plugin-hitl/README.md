# @apeira/plugin-hitl

Human-in-the-loop tool approval for Apeira agents.

## Install

```sh
pnpm add @apeira/plugin-hitl
```

## Usage

```ts
import { createAgent } from '@apeira/core'
import { responses } from '@apeira/core/responses'
import { commonTools } from '@apeira/plugin-common-tools'
import { autoReviewByPattern, humanInTheLoop } from '@apeira/plugin-hitl'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  plugins: [
    humanInTheLoop({
      autoReview: autoReviewByPattern({
        always: ['bash', 'write', 'edit'],
        never: ['read', /^search_/],
      }),
    }),
    commonTools(),
  ],
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

Subscribe to the `hitl` channel to render approval UI:

```ts
import { approveToolCall, rejectToolCall } from '@apeira/plugin-hitl'

agent.subscribe('hitl', (event) => {
  if (event.type !== 'hitl.request')
    return
  console.log(`Approve ${event.toolName}: ${event.toolCallId}`)
approveToolCall(agent, { toolCallId: event.toolCallId })
  // or: rejectToolCall(agent, { toolCallId: event.toolCallId, reason: 'User rejected' })
})
```

You can also drive approvals by emitting control events directly on the agent's `hitl` channel:

```ts
agent.emit('hitl', { toolCallId: 'call_123', type: 'control.approve' })
agent.emit('hitl', { reason: 'Unsafe', toolCallId: 'call_123', type: 'control.reject' })
```

Approval state is bound to the plugin instance (and therefore to the agent). Multiple agents do not share pending state.

Approvals may carry an optional structured resolution for tools that support one:

```ts
approveToolCall(agent, {
  toolCallId: 'call_123',
  resolution: {
    permissions: { network: { enabled: true } },
    scope: 'turn',
  },
})
```

The resolution is delivered through the tool execution context without changing model-provided arguments. Tools that do not use structured resolutions are unaffected.

## Events

The plugin emits and listens on the `hitl` channel.

### Output events (from plugin)

| Type | Description |
|------|-------------|
| `hitl.auto_reviewed` | A decision was made automatically by policy |
| `hitl.request` | A tool call is pending human approval |
| `hitl.resolved` | A pending tool call was resolved |

### Control events (to plugin)

| Type | Description |
|------|-------------|
| `control.approve` | Approve a pending tool call by `toolCallId` |
| `control.reject` | Reject a pending tool call by `toolCallId`, with optional `reason` |

## API

### `humanInTheLoop(options?)`

Installs a `preToolCall` hook that evaluates each tool call and either:

- auto-approves it
- auto-rejects it
- suspends execution until an approval control event is received

### `approveToolCall(agent, { toolCallId })`

Emits a `control.approve` event on the agent's `hitl` channel to resolve one pending tool call and let the original tool execute.

### `rejectToolCall(agent, { toolCallId, reason? })`

Emits a `control.reject` event on the agent's `hitl` channel to resolve one pending tool call with a rejection result instead of executing it.

### `autoReviewByPattern({ always, never })`

Creates a simple tool-name based policy using exact strings or `RegExp` patterns:

- `never`: auto-approve
- `always`: require approval
- unmatched tools: remain pending
