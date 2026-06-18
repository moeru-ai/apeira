import type { AgentEntry, AgentInput, CreateAgentOptions, Runner } from '@apeira/core'

import { createAgent, mem, run, toAgentInput, user } from '@apeira/core'

import {
  DEFAULT_COMPACTION_INSTRUCTIONS,
  DEFAULT_COMPACTION_TRIGGER,
} from './constants'
import { getMessageText } from './split'

export interface CompactAgentOptions {
  instructions?: CreateAgentOptions['instructions']
  runner?: Runner
}

export interface CompactHistoryOptions {
  compactAgent: CompactAgentOptions
  signal?: AbortSignal
}

const extractAssistantSummary = (items: readonly AgentEntry[]): string => {
  for (const item of toAgentInput(items).toReversed()) {
    if (item.type !== 'message' || item.role !== 'assistant')
      continue

    if (Array.isArray(item.content) && item.content.some(part => part.type === 'refusal'))
      throw new Error('Compaction summary was refused.')

    return getMessageText(item).trim()
  }

  return ''
}

export const executeCompact = async ({
  compactAgent,
  input,
  signal,
}: CompactHistoryOptions & { input: readonly AgentInput[] }): Promise<string> => {
  const runner = compactAgent.runner
  if (!runner)
    throw new Error('[@apeira/plugin-compact] compactAgent.runner is required when not using the parent agent runner.')

  const tempAgent = createAgent({
    instructions: compactAgent.instructions ?? DEFAULT_COMPACTION_INSTRUCTIONS,
    plugins: [],
    runner,
    storage: mem(input),
  })

  try {
    for await (const event of run(tempAgent, user(DEFAULT_COMPACTION_TRIGGER), { signal })) {
      if (event.type === 'turn.failed')
        throw event.error

      if (event.type === 'turn.aborted')
        throw event.reason
    }
  }
  finally {
    await tempAgent.stop()
  }

  const summary = extractAssistantSummary(await tempAgent.storage.read())
  if (summary.length === 0)
    throw new Error('Compaction produced an empty summary.')

  return summary
}
