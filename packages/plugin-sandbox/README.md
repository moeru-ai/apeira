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

const plugin = sandbox({
  adapter: createSrtAdapter(),
  profile: workspaceWriteProfile({ cwd: process.cwd() }),
})
```

The plugin installs `exec`, `write_stdin`, and `apply_patch`. Custom tool composition is intentionally left out of the initial API.

The baseline tool set contains:

- `exec` for foreground and persistent shell commands
- `write_stdin` for polling and interacting with persistent commands
- `apply_patch` for applying a standard unified diff with `git apply`

`apply_patch` requires Git on the execution path. It runs `git apply --recount --whitespace=nowarn -` inside the configured sandbox, does not use `--unsafe-paths`, and does not request automatic permission escalation. A patch that exceeds the active filesystem profile fails normally.

Escalation is fail-closed. A request using `require_escalated` is rejected unless the application supplies an `authorizeEscalation` callback and returns an `ExecutionGrant` minted for that exact request. Host bypass additionally requires an explicit `HostExecutor`.

## Advanced runtime API

Applications that need manual runtime ownership can use `createSandbox()` and the individual tool factories directly:

```ts
import {
  createExecutionGrant,
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

    return createExecutionGrant({
      escalation: request.escalation,
      requestId: context.requestId,
    })
  },
  hostExecutor: createHostExecutor(),
  profile: workspaceWriteProfile(),
})
```

## SRT constraints

- The initial adapter targets Linux.
- SRT owns process-global state, so only one active SRT adapter is allowed per Node.js process.
- SRT network proxy policy is process-global. Per-command filesystem expansion is supported, but per-command network policy changes are rejected to avoid widening access for concurrent commands.
- `sandbox()` owns its runtime and disposes it when the plugin stops.

`createHostExecutor()` is deliberately separate from a sandbox adapter. It exists for an application-approved bypass and must never be treated as isolation.
