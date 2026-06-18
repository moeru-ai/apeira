export const DEFAULT_COMPACTION_INSTRUCTIONS = `Your task is to create a handoff summary for another LLM that will resume the task.

Include:
- Capture all of the user's explicit requests and intents in detail
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`

export const DEFAULT_CONTEXT_LENGTH = 128_000
export const DEFAULT_THRESHOLD = 0.9
export const EMERGENCY_PRESERVE_THRESHOLD = 0.95
export const HARD_TRUNCATION_MESSAGE = '(Earlier conversation omitted due to length)'
export const MAX_COMPACT_FAILURES = 3
