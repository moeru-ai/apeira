# Getting Started

Apeira is a small TypeScript runtime for building agents that runs anywhere. The kernel handles a single turn pipeline; everything else is a plugin. You opt into plugins, tools, skills, and storage backends as you need them.

## Before you begin

You should have:

- Node.js 18 or newer
- `pnpm` installed (or npm / yarn)
- An OpenAI-compatible API key

## Two usage paths

Apeira serves two audiences. Pick the one that matches your goal today:

- **Application developer** — you want to embed an agent in your app. Read [Installation](/installation), then [First Turn](/guide/first-turn) to get started, then [Agent Lifecycle](/guide/agent-lifecycle) for queueing control.
- **Plugin author** — you want to extend Apeira with custom hooks, tools, or storage backends. Read [Plugins](/plugins/) after the first turn.

Both share the same starting point: install Apeira and run one turn to confirm the runtime is healthy.

## Recommended path

Work through these pages in order:

1. [Installation](/installation) — install from npm with `pnpm add apeira`.
2. [First Turn](/guide/first-turn) — create an agent, submit a turn, and consume the event stream.
3. [Agent Lifecycle](/guide/agent-lifecycle) — understand queueing and cancellation.
4. [Plugins](/plugins/) — extend the runtime with plugins.
