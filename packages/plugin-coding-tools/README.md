# @apeira/plugin-coding-tools

Codex-compatible coding tools for Apeira agents.

## Node.js

```ts
import { createAgent } from '@apeira/core'
import { codingTools } from '@apeira/plugin-coding-tools'

const agent = createAgent({
  plugins: [codingTools({ cwd: '/absolute/workspace' })],
  // ...runner and instructions
})
```

The Node.js backend provides `apply_patch`, `exec_command`, `view_image`, and `write_stdin`. It requires Node.js 24 or newer and `git` on `PATH`. The built-in backend does not provide a real PTY; calls with `tty: true` fail explicitly.

## Sandbox Runtime

Initialize Sandbox Runtime in the application, then import the optional backend from its subpath:

```ts
import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { codingTools } from '@apeira/plugin-coding-tools'
import { sandboxBackend } from '@apeira/plugin-coding-tools/sandbox'

await SandboxManager.initialize({
  filesystem: { allowRead: ['.'], allowWrite: ['.'], denyRead: [], denyWrite: [] },
  network: { allowedDomains: [] },
})

const tools = codingTools({
  backend: sandboxBackend(),
  cwd: '/absolute/workspace',
})
```

The sandbox backend also provides `request_permissions`. On Windows, Sandbox Runtime cannot add filesystem allow rules per command, so dynamic filesystem requests fail; configure them during `initialize()`. Dynamic network grants remain available.

## Permission review

Unreviewed permission requests grant the requested profile for the current turn. Production applications should gate `request_permissions` explicitly with `@apeira/plugin-hitl`:

```ts
import { approveToolCall, humanInTheLoop } from '@apeira/plugin-hitl'

const hitl = humanInTheLoop({
  toolPolicies: {
    request_permissions: { needsApproval: true },
  },
})

agent.subscribe('hitl', async (event) => {
  if (event.type !== 'hitl.request' || event.toolName !== 'request_permissions')
    return

  await approveToolCall(agent, {
    resolution: {
      permissions: { network: { enabled: true } },
      scope: 'turn',
    },
    toolCallId: event.toolCallId,
  })
})
```

The granted profile is intersected with the original request, so a reviewer can narrow permissions but cannot expand them. Advanced backends may implement an async `requestPermissions` method that invokes a reviewer agent directly.

`turn` scope controls which new processes may be launched with a grant. As in Codex, a background process already launched during that turn retains its sandbox profile until it exits or the plugin stops.

## Custom backend

Pass an object implementing `CodingToolsBackend` to `codingTools({ backend })`. Tool schemas and permission state remain owned by the plugin; backend methods receive the normalized cwd, turn/tool-call identity, abort signal, effective permissions, and any structured HITL resolution.
