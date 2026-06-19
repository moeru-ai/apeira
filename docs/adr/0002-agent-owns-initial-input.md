# Agent owns initial input

Initial input is an agent lifecycle concern, not a storage construction concern.

`createAgent()` accepts `initialInput`. During initialization, the agent appends
it only when storage contains no input entries. `agent.reset()` clears storage
and restores both `initialInput` and `initialState`.

Storage implementations expose only `append`, `read`, and `clear`. They do not
accept initial entries or provide reset semantics. This keeps storage as a data
container and gives every storage implementation the same agent lifecycle
behavior.

`initialState` follows the same baseline model: the agent snapshots it at
creation and restores it on reset. State entries in storage represent current
state and take precedence during initialization.

`fork()` may copy all of the parent's current entries into child storage,
including state entries. Those copied entries are working history and current
state, not the child's reset baseline. The child separately inherits or
overrides the parent's initial input and state.
