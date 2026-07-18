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

## Events and pending state

The `hitl` channel emits:

| Type | Description |
|------|-------------|
| `request` | A tool or permission request needs a decision |
| `resolved` | A policy, session cache, or user produced a terminal decision |
| `cancelled` | Abort, turn completion, or plugin shutdown cancelled the request |

Cancellation is not represented as rejection: rejection is a user/security decision and lets the agent continue unless `abortTurn` is set.

Applications can recover missed in-memory events through `approval.listPending({ turnId? })`. Pending resolvers and abort signals remain process-local; durable resume is not part of this version.

## API

- `hitl(options?)`: create the plugin, approval service, and sandbox authorizer.
- `approval.resolve(requestId, decision)`: resolve one pending request.
- `approval.listPending({ turnId? })`: list current pending requests.
- `toolPolicy(options)`: create a tool-name allow/deny policy from strings or regular expressions.
