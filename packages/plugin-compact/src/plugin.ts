import type { Agent, AgentEntry, AgentInput, AgentPlugin } from '@apeira/core'

import type { CompactAgentOptions } from './compact'

import { developer, entry, toAgentInput } from '@apeira/core'

import { name, version } from '../package.json'
import {
  executeCompact,
} from './compact'
import {
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_THRESHOLD,
  HARD_TRUNCATION_MESSAGE,
  MAX_COMPACT_FAILURES,
} from './constants'

export interface CompactEntry {
  lastEntryId?: string
  summary: string
}

declare module '@apeira/core' {
  interface AgentCustomEntry {
    compact: CompactEntry
  }
}

export interface CompactPluginOptions {
  compactAgent: CompactAgentOptions
  preserveEntries?: number
  threshold?: number
}

export const transformCompactEntries = (
  entries: readonly AgentEntry[],
): readonly AgentEntry[] => {
  const compactIndex = entries.findLastIndex(entry => entry.type === 'compact')
  if (compactIndex === -1)
    return entries

  const compactEntry = entries[compactIndex] as AgentEntry<'compact'>
  const summaryEntry: AgentEntry<'input'> = {
    ...compactEntry,
    data: developer(`<context_summary>\n${compactEntry.data.summary}\n</context_summary>`),
    type: 'input',
  }

  const lastEntryId = compactEntry.data.lastEntryId
  if (lastEntryId == null)
    return [summaryEntry, ...entries.slice(compactIndex + 1)]

  const lastSummarizedIndex = entries.findIndex(entry => entry.id === lastEntryId)
  if (lastSummarizedIndex === -1)
    return [summaryEntry, ...entries.slice(compactIndex + 1)]

  return [
    summaryEntry,
    ...entries.slice(lastSummarizedIndex + 1, compactIndex),
    ...entries.slice(compactIndex + 1),
  ]
}

export const compact = (options: CompactPluginOptions): AgentPlugin => {
  const preserveEntries = Math.max(0, Math.floor(options.preserveEntries ?? 0))
  const threshold = options.threshold ?? DEFAULT_THRESHOLD

  let agent: Agent | undefined
  let compactFailures = 0

  const getAgent = (): Agent => {
    if (!agent)
      throw new Error('[@apeira/plugin-compact] Plugin is not initialized.')

    return agent
  }

  const getContextLength = () => getAgent().state.get().contextLength ?? DEFAULT_CONTEXT_LENGTH

  const compactHistoricalInput = async (historicalInput: readonly AgentInput[]): Promise<string> => {
    try {
      const summary = await executeCompact({
        compactAgent: {
          instructions: options.compactAgent.instructions,
          runner: options.compactAgent.runner ?? getAgent().runner,
        },
        input: historicalInput,
      })

      compactFailures = 0
      return summary
    }
    catch (error) {
      compactFailures++

      if (compactFailures >= MAX_COMPACT_FAILURES) {
        compactFailures = 0
        return HARD_TRUNCATION_MESSAGE
      }

      console.warn('[@apeira/plugin-compact] Failed to compact context.', error)
      return ''
    }
  }

  return {
    init: (nextAgent) => {
      agent = nextAgent
    },
    name,
    onTurnFinish: async (turn) => {
      const contextLength = getContextLength()
      if (turn.usage == null || turn.usage.totalTokens < contextLength * threshold)
        return

      const activeAgent = getAgent()
      const projectedEntries = transformCompactEntries(await activeAgent.storage.read())

      const inputEntryIndices = projectedEntries
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => entry.type === 'input')
        .map(({ index }) => index)

      if (inputEntryIndices.length <= preserveEntries)
        return

      const entriesToSummarize = preserveEntries === 0
        ? projectedEntries
        : projectedEntries.slice(0, inputEntryIndices[inputEntryIndices.length - preserveEntries])

      if (entriesToSummarize.length === 0)
        return

      const summary = await compactHistoricalInput(toAgentInput(entriesToSummarize))
      if (summary.length === 0)
        return

      const lastEntryId = preserveEntries === 0
        ? entriesToSummarize.at(-1)?.id
        : entriesToSummarize.findLast(entry => entry.type === 'input')?.id
      await activeAgent.storage.append(entry('compact', { lastEntryId, summary }))
    },
    stop: () => {
      agent = undefined
    },
    transformEntries: transformCompactEntries,
    version,
  }
}
