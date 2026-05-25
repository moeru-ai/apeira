import type { ItemParam } from '../types/responses'

const MAX_TOOL_OUTPUT_LENGTH = 8_000
const TRUNCATE_PREFIX_LENGTH = 4_000
const TRUNCATE_SUFFIX_LENGTH = 4_000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null

const getCallId = (item: ItemParam): string | undefined => {
  const record = item as unknown as Record<string, unknown>
  return typeof record.call_id === 'string' ? record.call_id : undefined
}

const truncateToolOutput = (item: ItemParam): ItemParam => {
  if (!isRecord(item) || item.type !== 'function_call_output' || typeof item.output !== 'string')
    return item

  if (item.output.length <= MAX_TOOL_OUTPUT_LENGTH)
    return item

  const omitted = item.output.length - TRUNCATE_PREFIX_LENGTH - TRUNCATE_SUFFIX_LENGTH
  return {
    ...item,
    output: `${item.output.slice(0, TRUNCATE_PREFIX_LENGTH)}\n\n(truncated: ${omitted} chars omitted)\n\n${item.output.slice(-TRUNCATE_SUFFIX_LENGTH)}`,
  } as ItemParam
}

export const normalizeItems = (items: ItemParam[]): ItemParam[] => {
  const calls = new Set<string>()
  const normalized: ItemParam[] = []

  for (const item of items) {
    if (isRecord(item) && item.type === 'function_call') {
      const callId = getCallId(item)
      if (callId != null)
        calls.add(callId)

      normalized.push(item)
      continue
    }

    if (isRecord(item) && item.type === 'function_call_output') {
      const callId = getCallId(item)
      if (callId == null || !calls.has(callId))
        continue

      normalized.push(truncateToolOutput(item))
      continue
    }

    normalized.push(item)
  }

  return normalized
}
