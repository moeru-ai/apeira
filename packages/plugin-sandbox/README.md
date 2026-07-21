# @apeira/plugin-sandbox

Sandbox execution contracts and baseline coding tools for Apeira.

The root export provides backend-neutral sandbox contracts plus an Apeira plugin for `exec`, `write_stdin`, and `apply_patch`. `@apeira/plugin-sandbox/srt` binds those contracts to Anthropic's Sandbox Runtime (SRT); `@apeira/plugin-sandbox/tools` remains available as a focused tools entry point.

## Install

```sh
pnpm add @apeira/plugin-sandbox @anthropic-ai/sandbox-runtime
```

SRT is an optional peer dependency. Applications that provide another `SandboxAdapter` do not need to install it.

## Usage

```ts
import {
  sandbox,
  workspaceWriteProfile,
} from '@apeira/plugin-sandbox'
import { createSrtAdapter } from '@apeira/plugin-sandbox/srt'

const profile = workspaceWriteProfile({ cwd: process.cwd() })
const plugin = sandbox({
  adapter: createSrtAdapter({ networkProfile: profile.network }),
  profile,
})
```

The plugin installs `exec`, `write_stdin`, and `apply_patch`. Custom tool composition is intentionally left out of the initial API.

The baseline tool set contains:

- `exec` for foreground and persistent shell commands
- `write_stdin` for polling and interacting with persistent commands
- `apply_patch` for applying a standard unified diff with `git apply`

`apply_patch` requires Git on the execution path and lets `git apply --recount --whitespace=nowarn -` validate and apply the patch inside the configured sandbox.

Escalation is fail-closed. A request using `require_escalated` is rejected unless the application supplies an `authorizeEscalation` callback and returns an `ExecutionGrant` minted for that exact request. Host bypass additionally requires an explicit `HostExecutor`.

## Advanced runtime API

Applications that need manual runtime ownership can use `createSandbox()` and the individual tool factories directly:

```ts
import {
  createHostExecutor,
  createSandbox,
  workspaceWriteProfile,
} from '@apeira/plugin-sandbox'

const sandbox = createSandbox({
  adapter,
  authorizeEscalation: async (request, context) => {
    const approved = await askUser(request.escalation)
    if (!approved)
      return

    return context.createGrant()
  },
  hostExecutor: createHostExecutor(),
  profile: workspaceWriteProfile(),
})
```

`context.createGrant()` binds a one-time grant to the complete normalized execution request. Reusing a grant or changing the command, cwd, environment, or escalation invalidates it. The lower-level `createExecutionGrant()` export accepts the same normalized request shape for custom authorizers.

The sandbox owns cancellation across escalation authorization, backend startup, and running processes. The authorizer receives `context.signal` so it can stop its own I/O, but ignoring it does not prevent `execute()` from returning. Once a backend returns a process handle, the sandbox terminates it with SIGTERM and a one-second SIGKILL fallback when execution is aborted.

## SRT constraints

- The initial adapter targets Linux.
- SRT owns process-global state, so only one active SRT adapter is allowed per Node.js process.
- SRT network proxy policy is process-global and must be fixed through `createSrtAdapter({ networkProfile })`. Per-command filesystem expansion is supported, but per-command network policy changes are rejected before runtime initialization. Use an explicit host bypass when separately approved network access is required.
- `sandbox()` owns its runtime and disposes it when the plugin stops.

`createHostExecutor()` is deliberately separate from a sandbox adapter. It exists for an application-approved bypass and must never be treated as isolation.
