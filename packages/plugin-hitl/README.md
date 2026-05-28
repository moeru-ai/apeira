# @apeira/plugin-hitl

Human-in-the-loop tool control for Apeira agents.

This plugin is a policy layer over xsAI's `preToolCall` / `postToolCall` transformer hooks. It does not wrap tool executors and it does not require tool providers such as common-tools, MCP, or custom tools to depend on HITL types.

## Requirements

`@apeira/plugin-hitl` requires an `@apeira/core` version that provides plugin private session state and xsAI tool-call hook bridging. The plugin stores trusted conversation-scope approval memory in its own private state namespace; ordinary session context is not used as trusted approval storage.

## Usage

```ts
import { createAgent } from '@apeira/core'
import { hitl } from '@apeira/plugin-hitl'

const review = hitl({
  mode: 'ask',
  scope: 'conversation',
})

const agent = createAgent({
  instructions: 'You are a helpful agent.',
  name: 'demo',
  options: {
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-4.1-mini',
  },
  plugins: [review.plugin],
})
```

Subscribe to the normal Apeira event stream and render `tool-interruption` as a review card. Tool providers stay unchanged.

## Scope

v1 focuses on call/run/conversation decisions and model-visible reject results. Durable queues, workspace/global grants, sandboxing, and enterprise policy DSLs are intentionally outside this package.
