# Human-in-the-Loop (HITL) Plugin Design

## Date

2026-05-29

## Background

Apeira is a stream-first Agent Runtime. Agents use tools (via `@xsai-ext/responses`) to interact with the external world. Some tool calls are sensitive (writing files, executing shell commands) and should not run without human confirmation.

This design introduces `@apeira/plugin-hitl`, an **optional plugin** that intercepts tool calls before execution and optionally suspends them pending human approval.

## Design Goals

1. **Plugin-only**: Zero core changes. Users install the plugin if they want HITL; otherwise behavior is unchanged.
2. **Strategy-overridable**: Support both global auto-review rules and per-tool `needsApproval` declarations.
3. **Auto-review**: Read-only operations can auto-approve; dangerous operations auto-pend.
4. **Stream-compatible**: Works with Apeira's existing stream-first model (`run()`, `send()`, `subscribe()`).
5. **Example-ready**: Adaptable to existing `copilotkit` (browser) and `pi-tui` (terminal) examples with minimal example-side code.
6. **Sandbox-ready**: API shape leaves room for future remote/sandboxed tool execution approval.

## Design Decisions

### Chosen Approach: Pure Plugin via `preToolCall`

We use the existing `preToolCall` plugin hook to intercept tool execution. When approval is required, `preToolCall` returns a **pending Promise**, causing `executeTool` (inside `@xsai-ext/responses`) to await indefinitely. The stream pauses. External code resolves the Promise via module-level functions (`approveToolCall` / `rejectToolCall`), allowing execution to continue.

**Why not core changes?**
- Apeira has no users yet; keeping core minimal reduces long-term maintenance surface.
- `preToolCall`'s ability to return a `CompletionToolResult` (thereby skipping execution) or a `CompletionToolCall` (thereby continuing execution) gives us exactly the primitive we need.
- The pending-Promise pattern is reliable because `executeTool` awaits it, and `ToolExecuteOptions` exposes `abortSignal` for cleanup.

### Rejected Alternatives

- **Core HIL Primitives**: Would add `requestApproval` to `AgentPluginApi` and `resolveApproval` to `AgentSession`. Cleaner for consumers, but violates "zero core changes" and "just a plugin" goals.
- **Core Native Suspend/Resume**: Would introduce `turn.suspend/resume` state machines. Over-engineered for the current stage.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  @apeira/plugin-hitl                                        │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │ autoReview   │  │ toolPolicies │  │ rejectionMessage│   │
│  └──────┬───────┘  └──────┬───────┘  └────────┬────────┘   │
│         └─────────────────┼───────────────────┘             │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  preToolCall hook                                   │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────────────────┐ │   │
│  │  │approve  │  │reject   │  │pending Promise      │ │   │
│  │  │(return  │  │(return  │  │→ emit hitl.request  │ │   │
│  │  │ toolCall│  │ result) │  │→ await external     │ │   │
│  │  └─────────┘  └─────────┘  └─────────────────────┘ │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Module-level API                                     │   │
│  │  approveToolCall(toolCallId)                          │   │
│  │  rejectToolCall(toolCallId, reason?)                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌─────────┐    ┌──────────┐    ┌──────────┐
        │ pi-tui  │    │copilotkit│    │ sandbox  │
        │ /y /n   │    │ UI cards │    │(future)  │
        └─────────┘    └──────────┘    └──────────┘
```

## Plugin API

### Installation

```ts
import { autoReviewByPattern, humanInTheLoop } from '@apeira/plugin-hitl'

const agent = createAgent({
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

### Options

```ts
export type ApprovalDecision
  = { reason?: string, type: 'reject' }
    | { type: 'approve' }
    | { type: 'pending' }

export type AutoReviewPolicy = (
  toolCall: CompletionToolCall,
  context: { toolPolicies?: Record<string, ToolPolicy> }
) => ApprovalDecision

export interface HumanInTheLoopOptions {
  /**
   * Global auto-review policy.
   * Evaluated first; can be overridden by per-tool policies.
   */
  autoReview?: AutoReviewPolicy

  /**
   * Message returned to the model when a tool call is rejected.
   * Can be a static string or a function.
   */
  rejectionMessage?: RejectionMessageFn | string

  /**
   * Per-tool approval overrides keyed by tool name.
   */
  toolPolicies?: Record<string, ToolPolicy>
}

export type RejectionMessageFn = (
  toolCall: CompletionToolCall,
  reason?: string
) => string

export interface ToolPolicy {
  /**
   * Whether this tool requires approval.
   * - `false`: never requires approval
   * - `true`: always requires approval
   * - function: dynamic decision based on parsed arguments
   */
  needsApproval?: ((args: unknown) => boolean) | boolean
}
```

### External Control API

```ts
/**
 * Approve a pending tool call and allow it to execute.
 * Returns true if the toolCallId was found and approved;
 * false if it was already resolved or never pending.
 */
export declare function approveToolCall(toolCallId: string): boolean

/**
 * Reject a pending tool call. The model will receive a rejection message.
 * Returns true if the toolCallId was found and rejected;
 * false if it was already resolved or never pending.
 */
export declare function rejectToolCall(toolCallId: string, reason?: string): boolean
```

### Built-in Helpers

```ts
/**
 * Auto-review by tool name patterns.
 * - `never`: always auto-approve
 * - `always`: always require human approval
 */
export function autoReviewByPattern(options: {
  always?: string[]
  never?: string[]
}): AutoReviewPolicy
```

## Decision Chain

For each incoming tool call, the plugin evaluates the following in order:

1. **Per-tool `needsApproval`** (if the tool name exists in `toolPolicies`):
   - `false` → **auto-approve**
   - `true` → **pending**
   - function returning `false` → **auto-approve**
   - function returning `true` → **pending**
2. **Global `autoReview` function** (if provided):
   - returns `approve` → **auto-approve**
   - returns `reject` → **auto-reject**
   - returns `pending` → **pending**
3. **Default fallback** → **pending** (conservative)

If `autoReview` throws, fallback to **pending** (never silently approve a dangerous call).

## Event Types

All events are emitted on the **`hitl`** channel via `pluginApi.emit('hitl', event)`.

Examples subscribe with:

```ts
agent.subscribe('hitl', (event) => {})
// or on a session:
session.subscribe('hitl', (event) => {})
```

```ts
export interface HITLAutoReviewedEvent extends HITLBaseEvent {
  decision: 'approve' | 'reject'
  reason?: string
  type: 'hitl.auto_reviewed'
}

export interface HITLBaseEvent {
  sessionId: string
  timestamp: number
  toolCallId: string
  toolName: string
  turnId: string
}

export type HITLEvent
  = HITLAutoReviewedEvent
    | HITLRequestEvent
    | HITLResolvedEvent

export interface HITLRequestEvent extends HITLBaseEvent {
  /** JSON-stringified arguments */
  args: string
  type: 'hitl.request'
}

export interface HITLResolvedEvent extends HITLBaseEvent {
  /** true when resolved by auto-review; false when resolved by human */
  auto: boolean
  decision: 'approve' | 'reject'
  reason?: string
  type: 'hitl.resolved'
}
```

## Suspension Mechanism

### How It Works

1. `preToolCall` receives a `CompletionToolCall`.
2. After policy evaluation, if the decision is `pending`:
   - A `Deferred<T>` (Promise + resolve/reject) is created.
   - It is stored in a module-level `Map<key, Deferred>`.
   - `hitl.request` is emitted.
   - An `abort` listener is attached to `executeOptions.abortSignal`.
   - The Deferred's `promise` is returned from `preToolCall`.
3. `@xsai-ext/responses`'s `executeTool` awaits the returned Promise. The stream pauses.
4. When external code calls `approveToolCall(toolCallId)`:
   - The Deferred is resolved with the original `CompletionToolCall`.
   - `executeTool` sees no `result` field, so it proceeds to execute the tool normally.
5. When external code calls `rejectToolCall(toolCallId, reason)`:
   - The Deferred is resolved with a `CompletionToolResult` containing the rejection message.
   - `executeTool` sees the `result` field, so it **skips execution** and returns the rejection message directly to the model.
6. When the turn is aborted:
   - The `abortSignal` fires.
   - The listener rejects the Deferred.
   - `executeTool` throws, the stream ends, and Apeira handles it as `turn.aborted`.

### Key Implementation Detail

```ts
interface Deferred<T> {
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}

const pending = new Map<string, Deferred<CompletionToolCall | CompletionToolResult>>()
const pendingToolCalls = new Map<string, CompletionToolCall>() // keep original for approve

/**
 * Maps each turn's AbortSignal to its sessionId/turnId.
 * `onTurnStart`'s `options.signal` and `preToolCall`'s `executeOptions.abortSignal`
 * are the same object (both from the turn's AbortController), so this is race-free
 * even with multiple concurrent sessions.
 */
const turnContextBySignal = new WeakMap<AbortSignal, { sessionId: string, turnId: string }>()
```

The map key is `${turnId}:${toolCallId}`. Turn context is captured via the `onTurnStart` hook and looked up through the shared `AbortSignal`.

### Turn Context Tracking

```ts
const plugin: AgentPlugin = {
  name: '@apeira/plugin-hitl',

  onTurnStart: (options) => {
    turnContextBySignal.set(options.signal, {
      sessionId: options.sessionId,
      turnId: options.turnId,
    })
  },

  preToolCall: (toolCall, executeOptions) => {
    const ctx = turnContextBySignal.get(executeOptions.abortSignal!)
    if (!ctx)
      return toolCall // safety fallback

    const { sessionId, turnId } = ctx
    const key = `${turnId}:${toolCall.toolCallId}`

    // ... policy evaluation, pending logic, emit hitl.request ...
    console.log(sessionId, key)
  },
}
```

### Abort Cleanup

```ts
const onAbort = () => {
  pending.delete(key)
  deferred.reject(executeOptions.abortSignal?.reason ?? new Error('aborted'))
}
executeOptions.abortSignal?.addEventListener('abort', onAbort, { once: true })

try {
  return await deferred.promise
}
finally {
  executeOptions.abortSignal?.removeEventListener('abort', onAbort)
  pending.delete(key)
  pendingToolCalls.delete(key)
}
```

Because `executeTool` throws on rejection, `@xsai-ext/responses` propagates the error, `runResponse`'s `for await` exits, and `runTurn`'s catch block checks `controller.signal.aborted` to emit `turn.aborted` correctly.

## Rejection Message

When a tool call is rejected (auto or human), the model receives a `function_call_output` with the following text:

```
Tool execution was not approved.
```

If a reason is provided:

```
Tool execution was not approved. Reason: <reason>
```

Customizable via `options.rejectionMessage`.

## Example Integrations

### pi-tui

```ts
import { approveToolCall, humanInTheLoop, rejectToolCall } from '@apeira/plugin-hitl'

// agent.ts
export const agent = createAgent({
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

// app.ts
const pendingApprovals = new Map<string, HITLRequestEvent>()

const onEvent = (event: AgentEvent | HITLEvent) => {
  switch (event.type) {
    // ... existing events

    case 'hitl.request': {
      pendingApprovals.set(event.toolCallId, event)
      pushSystem(`Approval: ${event.toolName}(${event.args})`)
      pushSystem('  /y [id] — approve, /n [id] [reason] — reject')
      break
    }
    case 'hitl.resolved': {
      pendingApprovals.delete(event.toolCallId)
      break
    }
  }
  render()
}

// slash commands
const runCommand = async (commandLine: string) => {
  const [command, ...rest] = commandLine.slice(1).split(/\s+/)
  const argument = rest.join(' ').trim()

  switch (command) {
    case 'n': {
      const [id, ...reasonParts] = argument.split(/\s+/)
      rejectToolCall(id, reasonParts.join(' ') || 'Rejected by user')
      break
    }
    case 'y': {
      const targetId = argument || pendingApprovals.keys().next().value
      if (targetId)
        approveToolCall(targetId)
      else pushSystem('No pending approvals.')
      break
    }
  }
}
```

### copilotkit

```tsx
import { approveToolCall, humanInTheLoop, rejectToolCall } from '@apeira/plugin-hitl'

// agent.ts (same as pi-tui)

// React component
export const ApprovalPanel = ({ session }: { session: AgentSession }) => {
  const [requests, setRequests] = useState<HITLRequestEvent[]>([])

  useEffect(() => {
    return session.subscribe('hitl', (event: HITLEvent) => {
      if (event.type === 'hitl.request') {
        setRequests(prev => [...prev, event])
      }
      if (event.type === 'hitl.resolved') {
        setRequests(prev => prev.filter(r => r.toolCallId !== event.toolCallId))
      }
    })
  }, [session])

  return (
    <div>
      {requests.map(req => (
        <div key={req.toolCallId}>
          <span>
            {req.toolName}
            (
            {req.args}
            )
          </span>
          <button onClick={() => approveToolCall(req.toolCallId)}>Approve</button>
          <button onClick={() => rejectToolCall(req.toolCallId, 'User rejected')}>
            Reject
          </button>
        </div>
      ))}
    </div>
  )
}
```

## Sandbox Extension Points

The plugin is designed so that future sandbox support does not require API breakage:

1. **`autoReview` context parameter** can be extended with `sandboxId`, `executionEnvironment`, etc.
2. **`HITLRequestEvent` includes `sessionId` + `turnId` + `toolCallId`**, giving sandbox runtimes a stable correlation key for mapping remote executions to local approval UIs.
3. **`rejectToolCall`'s `reason`** is plumbed through to the model as structured text; future sandbox versions could extend this to return structured rejection payloads.
4. **The pending-Deferred layer is an internal implementation detail**. If cross-process persistence is needed later, only the `createDeferred` / `pending` Map needs to be replaced with a message-queue-backed implementation. The public API (`approveToolCall` / `rejectToolCall`) stays unchanged.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| `approveToolCall` / `rejectToolCall` called with unknown `toolCallId` | Return `false`. No throw. Idempotent. |
| `autoReview` throws | Fallback to `pending` (conservative). |
| `JSON.parse(toolCall.args)` fails during rejection result build | Use empty object `{}` as `args` in `CompletionToolResult`. |
| Abort while pending | `abortSignal` listener rejects Deferred → `executeTool` throws → Apeira emits `turn.aborted`. |
| Multiple tool calls in one step | Sequential approval. Each `preToolCall` is evaluated in order; the stream advances only after the previous pending call is resolved. |

## Testing Strategy

- **Unit tests** (inside `packages/plugin-hitl`):
  - Mock `preToolCall` invocations with all three decision paths (approve / reject / pending).
  - Verify `approveToolCall` and `rejectToolCall` resolve the correct Deferred.
  - Verify `abortSignal` correctly rejects pending Deferreds.
  - Verify `autoReviewByPattern` helper logic.

- **Integration tests** (inside `packages/core` test harness or a dedicated test file):
  - Create an agent with `plugin-hitl` and a dummy tool.
  - Send a message that triggers the dummy tool.
  - Assert `hitl.request` event is emitted.
  - Call `approveToolCall`.
  - Assert tool executes and `hitl.resolved` is emitted.

- **Example tests**:
  - `pi-tui`: Script-driven test that sends input, intercepts `hitl.request`, calls `approveToolCall`, asserts tool output appears in transcript.
  - `copilotkit`: Component test for `ApprovalPanel` rendering and button clicks.

## Files to Create

```
packages/
  plugin-hitl/
    src/
      index.ts           # main exports: humanInTheLoop, approveToolCall, rejectToolCall, autoReviewByPattern
      types.ts           # HITLEvent, HumanInTheLoopOptions, ApprovalDecision, etc.
      utils/
        deferred.ts      # createDeferred helper
        decision.ts      # resolveDecision logic
        message.ts       # buildRejectionResult
        policy.ts        # autoReviewByPattern
    package.json
    tsconfig.json
    README.md
```

## Open Questions (None)

All design decisions have been validated through the brainstorming process.
