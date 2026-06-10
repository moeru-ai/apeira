import type { CreateAgentOptions, ItemParam, Runner } from '@apeira/core'

import type { RetainedMessage } from './split'

import { createAgent, developer, run, user } from '@apeira/core'

import {
  DEFAULT_COMPACTION_INSTRUCTIONS,
  EMERGENCY_PRESERVE_THRESHOLD,
  HARD_TRUNCATION_MESSAGE,
} from './constants'
import {
  buildCompactInput,
  estimateTokens,
  getMessageText,
  selectRetainedUserMessages,
  splitHistory,
} from './split'

export interface CompactAgentOptions {
  instructions?: CreateAgentOptions['instructions']
  runner: Runner
}

export interface CompactHistoryOptions {
  compactAgent: CompactAgentOptions
  contextLength: number
  maxRetainedUserTokens: number
  preserveTurns: number
  signal?: AbortSignal
}

export interface CompactHistoryResult {
  input: ItemParam[]
  summary: string
}

const extractAssistantSummary = (items: ItemParam[]): string => {
  for (const item of items.toReversed()) {
    if (item.type !== 'message' || item.role !== 'assistant')
      continue

    if (Array.isArray(item.content) && item.content.some(part => part.type === 'refusal'))
      throw new Error('Compaction summary was refused.')

    return getMessageText(item).trim()
  }

  return ''
}

const splitWithEmergencyPreserve = (
  items: ItemParam[],
  preserveTurns: number,
  contextLength: number,
) => {
  let result = splitHistory(items, preserveTurns)

  if (result.hasEnoughTurns && estimateTokens(result.preserved) <= contextLength * EMERGENCY_PRESERVE_THRESHOLD)
    return result

  if (preserveTurns > 1) {
    result = splitHistory(items, 1)
    if (result.hasEnoughTurns && estimateTokens(result.preserved) <= contextLength * EMERGENCY_PRESERVE_THRESHOLD)
      return result
  }

  return splitHistory(items, 0)
}

export const assembleCompactedInput = (
  summary: string,
  retainedUserMessages: RetainedMessage[],
  preservedTurns: ItemParam[],
): ItemParam[] => [
  ...retainedUserMessages.map(retained => user(retained.text)),
  developer(`<context_summary>\n${summary}\n</context_summary>`),
  ...preservedTurns,
]

export const hardTruncateInput = (
  items: ItemParam[],
  preserveTurns: number,
  contextLength: number,
): ItemParam[] => {
  const { preserved } = splitWithEmergencyPreserve(items, preserveTurns, contextLength)

  return [
    developer(HARD_TRUNCATION_MESSAGE),
    ...preserved,
  ]
}

export const executeCompact = async ({
  compactAgent,
  contextLength,
  input,
  maxRetainedUserTokens,
  preserveTurns,
  signal,
}: CompactHistoryOptions & { input: ItemParam[] }): Promise<CompactHistoryResult> => {
  const initialSplit = splitHistory(input, preserveTurns)
  if (!initialSplit.hasEnoughTurns || initialSplit.compressible.length === 0)
    return { input, summary: '' }

  const { compressible, hasEnoughTurns, preserved } = splitWithEmergencyPreserve(
    input,
    preserveTurns,
    contextLength,
  )

  if (!hasEnoughTurns || compressible.length === 0)
    return { input, summary: '' }

  const retainedUserMessages = selectRetainedUserMessages(compressible, maxRetainedUserTokens)
  const compactInput = buildCompactInput(compressible, retainedUserMessages)

  const tempAgent = createAgent({
    input: compactInput,
    instructions: compactAgent.instructions ?? DEFAULT_COMPACTION_INSTRUCTIONS,
    plugins: [],
    runner: compactAgent.runner,
  })

  try {
    for await (const event of run(tempAgent, user('Summarize the conversation.'), { signal })) {
      if (event.type === 'turn.failed')
        throw event.error

      if (event.type === 'turn.aborted')
        throw event.reason
    }
  }
  finally {
    await tempAgent.stop()
  }

  const summary = extractAssistantSummary(tempAgent.getInput())
  if (summary.length === 0)
    throw new Error('Compaction produced an empty summary.')

  return {
    input: assembleCompactedInput(summary, retainedUserMessages, preserved),
    summary,
  }
}
