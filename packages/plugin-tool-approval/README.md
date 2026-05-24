# @apeira/plugin-tool-approval

Tool approval policy plugin for Apeira agents.

This plugin uses the core tool-call control pipeline to decide whether a tool call should continue or be blocked. It is generic and applies to tools from `responseOptions.tools`, plugins such as `@apeira/plugin-common-tools`, MCP tools, and custom tool plugins after core resolves the final tool list.

## Install

```sh
pnpm add @apeira/plugin-tool-approval
```

## Usage

```ts
import { createAgent } from '@apeira/core'
import { commonTools } from '@apeira/plugin-common-tools'
import {
  commonToolsApprovalHints,
  toolApproval,
  toolApprovalHints,
  withToolApprovalHints,
} from '@apeira/plugin-tool-approval'

const approvals = toolApproval({
  mode: 'ask',
  policy: async (request) => {
    if (request.risk === 'read')
      return { scope: 'conversation', type: 'allow' }

    return { message: `Approval required for ${request.toolName}`, type: 'ask' }
  },
})

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [
    commonTools(),
    toolApprovalHints(commonToolsApprovalHints()),
    approvals,
  ],
})

// Runtime changes apply to the next tool call.
approvals.setMode('deny')
approvals.setPolicy(request =>
  request.risk === 'read'
    ? { scope: 'conversation', type: 'allow' }
    : { type: 'deny' },
)
```

## Try the example

Run the CLI playground to inspect the full approval loop before reading the lower-level tests:

```sh
pnpm -F @apeira/example-tool-approval-cli dev
```

For a more visual flow, run the browser playground:

```sh
pnpm -F @apeira/example-tool-approval-ui dev
```

The example uses a replay model by default, so it does not require an API key. It shows each approval request with the tool name, risk, source, targets, and input, then lets you choose:

| Choice | Decision |
|--------|----------|
| `1` | Allow once |
| `2` | Allow this turn |
| `3` | Allow conversation |
| `4` | Deny |

Both playgrounds are for approval experience testing. Their `runCommand` tool only simulates command execution; they are not sandboxes and do not run a real shell command.

## API

### `toolApproval(options?)`

Creates an Apeira plugin with runtime controls:

```ts
type ToolApprovalAllowScope
  = | 'conversation'
    | 'once'
    | 'turn'

type ToolApprovalClassify<TContext = unknown> = (
  input: ToolApprovalClassificationInput<TContext>,
) => MaybePromise<ToolApprovalClassification | void>

type ToolApprovalDecision
  = | { message?: string, type: 'ask' }
    | { message?: string, type: 'deny' }
    | { scope?: ToolApprovalAllowScope, type: 'allow' }

type ToolApprovalMode = 'allow' | 'ask' | 'deny' | 'off'

interface ToolApprovalOptions<TContext = unknown> {
  classify?: ToolApprovalClassify<TContext>
  missingPolicy?: 'allow' | 'deny'
  mode?: ToolApprovalMode
  onDecision?: (event: ToolApprovalDecisionEvent<TContext>) => MaybePromise<void>
  policy?: ToolApprovalPolicy<TContext>
}

type ToolApprovalPolicy<TContext = unknown> = (
  request: ToolApprovalRequest<TContext>,
) => MaybePromise<ToolApprovalDecision>
```

The returned plugin also exposes:

| Method | Description |
|--------|-------------|
| `setMode(mode)` | Change approval mode for future tool calls |
| `setPolicy(policy)` | Replace the runtime policy function |
| `clearHistory(filter?)` | Clear remembered conversation-level approvals |

## Modes

| Mode | Behavior |
|------|----------|
| `off` | Approval plugin does nothing and returns `continue` |
| `allow` | Allows every tool call without writing approval history |
| `ask` | Uses `policy(request)` to decide; missing policy defaults to deny |
| `deny` | Blocks every tool call with `TOOL_APPROVAL_DENIED` |

## Scopes

| Scope | Behavior |
|-------|----------|
| `once` | Allows only the current tool call |
| `turn` | Allows matching calls for the current turn only |
| `conversation` | Stores the allow decision in plugin private session state |

Conversation history is stored in the plugin private state namespace managed by `@apeira/core`. It is persisted with the session, but it is not stored in normal agent context and cannot be changed through `session.setContext()`.

## Approval Hints

`@apeira/core` does not define approval concepts such as `risk` or `targets`, and tool provider plugins do not need to know whether approval is installed. Add approval hints at agent composition time:

```ts
createAgent({
  plugins: [
    commonTools(),
    toolApprovalHints(commonToolsApprovalHints()),
    toolApproval({ mode: 'ask', policy }),
  ],
})
```

For a custom plugin, either add a standalone hints plugin after the tool provider:

```ts
toolApprovalHints(({ input, toolName }) => {
  if (toolName !== 'runCommand')
    return

  const { command } = input as { command?: string }
  return {
    risk: 'execute',
    source: 'my-tools',
    targets: command == null
      ? []
      : [{ operation: 'execute', type: 'command', value: command }],
  }
})
```

Or wrap the tool provider directly:

```ts
createAgent({
  plugins: [
    withToolApprovalHints(myTools(), myToolApprovalHints),
    toolApproval({ mode: 'ask', policy }),
  ],
})
```

When no hints or custom `classify()` result is provided, approval requests use `risk: 'unknown'` and empty targets.

## Approval requests

Policies receive a `ToolApprovalRequest`:

```ts
interface ToolApprovalRequest<TContext = unknown> {
  agentName: string
  context: AgentContext<TContext>
  hints: ToolApprovalHints
  input: unknown
  risk: 'execute' | 'external' | 'network' | 'read' | 'unknown' | 'write'
  sessionId: string
  signal: AbortSignal
  source?: string
  targets: ToolApprovalTarget[]
  tool: Tool
  toolName: string
  turnId: string
}
```

The approval key includes the tool name, input, source, risk, and targets. For example, allowing `bash({ command: 'git status' })` does not allow `bash({ command: 'rm -rf .' })`.

## Rule helper

Use `createToolApprovalPolicy()` for simple risk, source, or tool-name rules:

```ts
import { createToolApprovalPolicy } from '@apeira/plugin-tool-approval'

const policy = createToolApprovalPolicy([
  { decision: { scope: 'conversation', type: 'allow' }, risk: 'read' },
  { decision: { type: 'deny' }, risk: 'execute' },
])
```

For enterprise or product-specific approval flows, provide your own `policy(request)` instead of building a complex rule DSL.

## Scope

This v1 plugin does not implement workspace/global approval scope, sandboxing, or durable human-in-the-loop pause/resume. Those should be layered on top of the core tool-call pipeline or implemented by host policy and execution wrappers.
