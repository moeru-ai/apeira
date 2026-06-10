# @apeira/plugin-ag-ui

Bridges Apeira lifecycle and model events to `@ag-ui/core` format, enabling AG-UI compatible frontends (such as CopilotKit) to render agent conversations.

## Install

```sh
pnpm add @apeira/plugin-ag-ui
```

## Usage

```ts
import { createAgent, responses } from '@apeira/core'
import { agui } from '@apeira/plugin-ag-ui'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  plugins: [agui({ threadId: 'thread-1' })],
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

## API

### `agui(options)`

Creates an Apeira plugin that maps agent events to `@ag-ui/core` AGUIEvent types:

| Apeira event | AG-UI event |
|-------------|-------------|
| `turn.start` | `RUN_STARTED` |
| `turn.done` | `RUN_FINISHED` |
| `turn.failed` | `RUN_ERROR` |
| `turn.aborted` | `RUN_FINISHED (aborted)` |
| `text.start` / `text.delta` / `text.done` | `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` |
| `reasoning.start` / `reasoning.delta` / `reasoning.done` | `REASONING_START` / `REASONING_MESSAGE_CONTENT` / `REASONING_END` |
| `tool-call.start` / `tool-call.delta` / `tool-call.done` | `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` |
| `tool-result.done` | `TOOL_CALL_RESULT` |
| `step.start` / `step.done` | `STEP_STARTED` / `STEP_FINISHED` |

### Options

```ts
interface AGUIPluginOptions {
  threadId: string
}
```

Events are emitted on the `'ag-ui'` channel via `agent.emit()`. Use `agent.subscribe('ag-ui', event => ...)` to receive typed AG-UI events — the package augments `AgentCustomEvent` so `event` is automatically inferred as `AGUIEvent`.
