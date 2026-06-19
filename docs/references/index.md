# Reference

This section describes the internal design models that Apeira is built from. You do not need to read it to use the library, but it is useful when building custom plugins, runners, or storage backends.

- [AgentChannel](/references/agent-channel) — typed event bus used by agents and plugins.
- [AgentPlugin](/references/agent-plugin) — hook interface for extending the agent lifecycle.
- [AgentQueue](/references/agent-queue) — turn queueing, draining, aborts, and the turn loop.
- [AgentStateManager](/references/agent-state-manager) — state manager and persistence hooks.
