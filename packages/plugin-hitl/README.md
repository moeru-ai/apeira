# @apeira/plugin-hitl

One approval service for Apeira tool calls and sandbox permissions.

## Usage

```ts
import { createAgent } from '@apeira/core'
import { hitl, toolPolicy } from '@apeira/plugin-hitl'

const approval = hitl({
  policies: [toolPolicy({
    allow: ['read', /^search_/],
    deny: ['delete_everything'],
    denyReason: 'Destructive tools are disabled.',
  })],
})

const agent = createAgent({
  // ...
  plugins: [approval],
})

agent.subscribe('hitl', (event) => {
  if (event.type !== 'request')
    return

  renderApproval(event.request, decision =>
    approval.resolve(event.request.requestId, decision))
})
```

Every request uses `request.type` to distinguish its subject:

```ts
if (request.type === 'tool')
  console.log(request.toolCall)
else
  console.log(request.command, request.escalation)
```

## Decisions

`resolve()` accepts terminal decisions only:

```ts
approval.resolve(requestId, { type: 'approve' })
approval.resolve(requestId, { scope: 'session', type: 'approve' })
approval.resolve(requestId, { args: editedJson, type: 'edit' })
approval.resolve(requestId, { message: 'Try another approach', type: 'reject' })
approval.resolve(requestId, {
  abortTurn: true,
  message: 'Stop this turn',
  type: 'reject',
})
```

`request.options` tells the UI which decisions are valid. Permission requests do not support `edit`. Session approval is an in-memory exact cache and is cleared when the plugin stops; it does not modify persistent policy.

`resolve()` returns `false` when the request is missing, already finished, or does not support the supplied decision.

## Sandbox permissions

The plugin instance is also a sandbox escalation authorizer:

```ts
import { hitl, toolPolicy } from '@apeira/plugin-hitl'
import { sandbox, workspaceWriteProfile } from '@apeira/plugin-sandbox'
import { createSrtAdapter } from '@apeira/plugin-sandbox/srt'

const approval = hitl({
  policies: [toolPolicy({
    allow: ['exec', 'write_stdin', 'apply_patch'],
  })],
})

const plugins = [
  approval,
  sandbox({
    adapter: createSrtAdapter(),
    authorizeEscalation: approval.authorizeEscalation,
    profile: workspaceWriteProfile(),
  }),
]
```

The baseline tools are allowed by tool policy, while requests for additional filesystem/network access or host bypass enter the same pending request queue. Only the sandbox authorizer can mint an `ExecutionGrant`, bound to the exact execution request.

## Policies

Policies are separate from human decisions. They return:

```ts
{ type: 'allow' }
{ type: 'ask' }
{ type: 'deny', reason: '...' }
undefined // no opinion
```

Policies may be asynchronous. Results are combined as `deny > ask > allow`; if every policy abstains, the plugin asks the user. A thrown policy is treated as `ask`. A deny always takes precedence over a cached session approval.

```ts
const approval = hitl({
  policies: [
    toolPolicy({ allow: ['read'] }),
    request => request.type === 'permission' && request.escalation.type === 'bypass'
      ? { reason: 'Host bypass is disabled.', type: 'deny' }
      : undefined,
  ],
})
```

Without policies, every tracked request asks the user. Requests without an active turn fail closed.

## Approve for me

Automatic review is an optional subpath:

```ts
import { hitl } from '@apeira/plugin-hitl'
import { autoReview } from '@apeira/plugin-hitl/auto-review'

const reviewer = autoReview({
  // Defaults to the parent agent runner when omitted.
  runner: cheaperReviewRunner,
  // The application must ensure these tools are read-only.
  tools: readonlyInvestigationTools,
})

const approval = hitl({ reviewer })
```

Only requests that remain `ask` after policies and the session cache are reviewed. An automatic approval applies once and is never added to the session cache.

Each review creates and stops a temporary agent with no plugins. It receives a bounded projection of the current conversation, the exact requested action, the supplied investigation tools, and an internal structured decision tool. Review requests are processed serially.

The defaults deny an explicit reviewer denial and ask the user after a reviewer system failure:

```ts
autoReview({
  onDeny: 'deny',
  onFailure: 'ask',
  timeoutMs: 90_000,
})
```

`plugin-hitl/auto-review` does not import or create a sandbox. Applications that provide investigation tools are responsible for constraining them. Without tools, the reviewer decides from the projected conversation and request.

Reviewer selection can change at runtime. The change affects future requests only:

```ts
approval.setReviewer('user')
approval.setReviewer(reviewer)
```

## Events and pending state

The `hitl` channel emits:

| Type | Description |
|------|-------------|
| `reviewing` | An automatic reviewer started assessing the request |
| `review_failed` | Automatic review failed before producing a decision |
| `request` | A tool or permission request needs a decision |
| `resolved` | A policy, reviewer, session cache, or user produced a terminal decision |
| `cancelled` | Abort, turn completion, or plugin shutdown cancelled the request |

Cancellation is not represented as rejection: rejection is a user/security decision and lets the agent continue unless `abortTurn` is set.

Applications can recover missed in-memory events through `approval.listPending({ turnId? })`. Pending resolvers and abort signals remain process-local; durable resume is not part of this version.

## API

- `hitl(options?)`: create the plugin, approval service, and sandbox authorizer.
- `approval.resolve(requestId, decision)`: resolve one pending request.
- `approval.listPending({ turnId? })`: list current pending requests.
- `approval.setReviewer('user' | reviewer)`: select who handles future `ask` requests.
- `toolPolicy(options)`: create a tool-name allow/deny policy from strings or regular expressions.
- `autoReview(options?)`: create the optional temporary-agent reviewer from `@apeira/plugin-hitl/auto-review`.
