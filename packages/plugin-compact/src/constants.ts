export const DEFAULT_COMPACTION_INSTRUCTIONS = `You are creating a handoff summary so another LLM can continue this task without re-asking the user.

The conversation history above is passed to you exactly as the next LLM will see it, including user messages, assistant responses, tool_use/tool_result pairs, and any image or multimodal content. Preserve the substance of all of these.

Your summary must include:

1. What the user wants — explicit requests, goals, and any constraints or preferences.
2. What has been done — key changes, file paths, function names, and code patterns. Include exact identifiers; do not paraphrase them.
3. What went wrong — errors encountered and how they were resolved, plus specific user feedback that changed direction.
4. What is next — the most logical next action to continue the current task, with a direct quote from the most recent relevant message.
5. Anything else needed — critical data, references, or decisions required to continue.

Be concise but complete. The next LLM should be able to resume the task as if the conversation had not been interrupted.`

export const DEFAULT_COMPACTION_TRIGGER = 'Write the handoff summary now.'

export const DEFAULT_CONTEXT_LENGTH = 128_000
export const DEFAULT_THRESHOLD = 0.9
export const EMERGENCY_PRESERVE_THRESHOLD = 0.95
export const HARD_TRUNCATION_MESSAGE = '(Earlier conversation omitted due to length)'
export const MAX_COMPACT_FAILURES = 3
