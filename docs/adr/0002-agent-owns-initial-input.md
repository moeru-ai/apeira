# Agent owns initial input

Initial input is an agent lifecycle concern, not a storage construction concern.

`createAgent()` accepts `initialInput`. During initialization, the agent appends
it only when storage contains no input entries. `agent.reset()` clears storage
and restores both `initialInput` and `initialState`.

Storage implementations expose only `append`, `read`, and `clear`. They do not
accept initial entries or provide reset semantics. This keeps storage as a data
container and gives every storage implementation the same agent lifecycle
behavior.

`fork()` may copy the parent's current non-state entries into child storage.
Those copied entries are working history, not the child's reset baseline.
