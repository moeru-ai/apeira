# @apeira/plugin-hitl

Human-in-the-loop tool approval for Apeira agents.

## Install

```sh
pnpm add @apeira/plugin-hitl
```

## Usage

```ts
import { createAgent } from '@apeira/core'
import { autoReviewByPattern, humanInTheLoop } from '@apeira/plugin-hitl'
import { commonTools } from '@apeira/plugin-common-tools'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [
    humanInTheLoop({
      autoReview: autoReviewByPattern({
        always: ['bash', 'write', 'edit'],
        never: ['read', 'search'],
      }),
    }),
    commonTools(),
  ],
})
```

Subscribe to the `hitl` channel to render approval UI:

```ts
import { approveToolCall, rejectToolCall } from '@apeira/plugin-hitl'

agent.subscribe('hitl', (event) => {
  if (event.type === 'hitl.request') {
    console.log(`Approve ${event.toolName}: ${event.toolCallId}`)
    approveToolCall(event.toolCallId)
    rejectToolCall(event.toolCallId, 'User rejected')
  }
})
```

## API

### `humanInTheLoop(options?)`

Installs a `preToolCall` hook that evaluates each tool call and either:

- auto-approves it
- auto-rejects it
- suspends execution until `approveToolCall()` or `rejectToolCall()` is called

### `approveToolCall(toolCallId)`

Resolves one pending tool call and lets the original tool execute.

### `rejectToolCall(toolCallId, reason?)`

Resolves one pending tool call with a rejection result instead of executing it.

### `autoReviewByPattern({ always, never })`

Creates a simple tool-name based policy:

- `never`: auto-approve
- `always`: require approval
- unmatched tools: remain pending
