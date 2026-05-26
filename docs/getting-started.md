# Getting Started

Apeira is a small TypeScript runtime for building agents that runs anywhere. The kernel handles a single turn pipeline; everything else is a plugin. You opt into plugins, tools, skills, and storage backends as you need them.

## Before you begin

You should have:

- Node.js 18 or newer
- `pnpm` installed (or npm / yarn)
- An OpenAI-compatible API key

## Three usage paths

Apeira serves three audiences. Pick the one that matches your goal today:

- **Application developer** — you want to embed an agent in your app. Read [Installation](/installation), then [First Turn](/guide/first-turn) to get started, then [Sessions](/guide/sessions), [Episodic](/advanced/episodic), and [Agent Lifecycle](/guide/agent-lifecycle) for session and queueing control.
- **Plugin author** — you want to extend Apeira with custom hooks, tools, or storage backends. Read [Plugins](/plugins/) after the first turn.
- **Package author** — you want to bundle Apeira with a curated plugin set for a specific scenario. Start with the umbrella package, then see [Packages](/reference/packages) for the module layout.

All three share the same starting point: install Apeira and run one turn to confirm the runtime is healthy.

## Recommended path

Work through these pages in order:

1. [Installation](/installation) — install from npm with `pnpm add apeira`.
2. [First Turn](/guide/first-turn) — create an agent, submit a turn, and consume the event stream.
3. [Sessions](/guide/sessions) — isolate conversations with explicit sessions.
4. [Episodic](/advanced/episodic) — understand session history, boundaries, and persistence.
5. [Agent Lifecycle](/guide/agent-lifecycle) — understand queueing and cancellation.
6. [Plugins](/plugins/) — extend the runtime with plugins.

If you want the API surface first, read [Core API](/reference/core) before the tutorials.

## Next steps

- [Installation](/installation) — start the recommended path.
- [Core API](/reference/core) — see every export at a glance.
