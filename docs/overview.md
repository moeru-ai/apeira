# Overview

Apeira is a small TypeScript runtime for building agents that runs anywhere. The kernel handles a single turn pipeline — queueing, reading history, running the model, and emitting events — while optional capabilities are composed through plugins, runners, and storage adapters.

## Why Apeira?

### extra-small, again

Apeira is built on [xsAI](https://github.com/moeru-ai/xsai) and inherits its lightweight footprint.

- `@apeira/core` [![bundle size](https://deno.bundlejs.com/?q=@apeira/core&badge=detailed)](https://bundlejs.com/?q=@apeira/core)
- `@apeira/session` [![bundle size](https://deno.bundlejs.com/?q=@apeira/session&badge=detailed)](https://bundlejs.com/?q=@apeira/session)
- `apeira` [![bundle size](https://deno.bundlejs.com/?q=apeira&badge=detailed)](https://bundlejs.com/?q=apeira)

The core package is only concerned with turn queueing, aborts, and event delivery. Runners, tools, storage, and UI bridges live in separate packages, so you pay for only what you use.

### Plugin-first

Plugins provide lifecycle extensions such as skills, context compaction, human-in-the-loop approvals, MCP servers, and UI bridges. Register them in the `plugins` array when creating an agent. Runners and storage backends use their own explicit `runner` and `storage` options.

Plugins extend the agent through a small hook interface. They can inject instructions, append tools, transform history entries, react to turn finish, and communicate over typed channels. Apeira runs them in registration order, or `enforce: 'pre'` / `enforce: 'post'` when ordering matters.

See the [Plugins overview](/plugins/) for available packages and the [AgentPlugin](/references/agent-plugin) reference for building your own.

### Append-only entries

An Apeira agent keeps an append-only log of input entries. For each runner call, the kernel reads the current history and combines it with that call's live input. A successful runner call appends its input and output immediately. If a later runner call in the same top-level turn fails or is aborted, entries from earlier successful calls remain stored. `interrupt()` additionally records a model-visible `<turn_aborted>` boundary.

This design makes history predictable: the model always sees a clean sequence of what actually happened, and plugins can safely read and transform entries before each turn. Storage is pluggable too — use the built-in `mem()` for tests, `@apeira/storage` for file or key-value persistence, or bring your own `AgentStorage` implementation.

Learn more in [Agent](/guide/agent), [Input](/guide/input), [Event](/guide/event), [Storage](/guide/storage), and [Entry](/guide/entry).

### Session management

For tree-shaped, durable conversation history, use `@apeira/session`. It layers branches, checkout, fork, and rebase on top of the same append-only entry model.

`session.storage` is the active branch view used by core, while `session.sessionStorage` keeps the complete append-only log. Branch changes emit `session.checkout`, `session.fork`, and `session.rebase` events on the agent channel.

See the [Session](/guide/session) for branch operations and custom semantic entries.
