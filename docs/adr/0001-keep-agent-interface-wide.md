# Keep Agent interface wide with fire-and-forget send

The `Agent` interface currently extends `AgentChannel`, `AgentQueue`, and adds state/lifecycle methods (`getInput`, `setInput`, `getState`, `setState`, `init`, `stop`). A proposal to narrow the caller-facing seam to only `send(input) → ReadableStream<AgentEvent>` and `stop()` — absorbing `run()`, `channel`, and `queue` into the implementation — was rejected.

We decided to keep the wide interface. `send()` remains fire-and-forget; output is consumed through `subscribe()`. `run()` is intentionally thin sugar. Input and state setters are meaningful because plugins and callers need to mutate agent context between turns. The separation of "send fire-and-forget" from "subscribe for output" is a deliberate design invariant, not accidental leakage.
