import type { Agent, AgentInput, AgentPlugin } from '@apeira/core'

import type { CompactAgentOptions } from './compact'

import { name, version } from '../package.json'
import {
  executeCompact,
  hardTruncateInput,
} from './compact'
import {
  DEFAULT_CONTEXT_LENGTH,
  DEFAULT_MAX_RETAINED_USER_TOKENS,
  DEFAULT_PRESERVE_TURNS,
  DEFAULT_THRESHOLD,
  MAX_COMPACT_FAILURES,
} from './constants'
import { estimateTokens } from './split'

export interface CompactPluginOptions {
  compactAgent: CompactAgentOptions
  maxRetainedUserTokens?: number
  preserveTurns?: number
  threshold?: number
}

export const compact = (options: CompactPluginOptions): AgentPlugin => {
  const maxRetainedUserTokens = options.maxRetainedUserTokens ?? DEFAULT_MAX_RETAINED_USER_TOKENS
  const preserveTurns = Math.max(0, Math.floor(options.preserveTurns ?? DEFAULT_PRESERVE_TURNS))
  const threshold = options.threshold ?? DEFAULT_THRESHOLD

  let agent: Agent | undefined
  let compactFailures = 0
  let needsCompact = false
  let stepCount = 0
  let unsubscribe: (() => void) | undefined

  const getAgent = (): Agent => {
    if (!agent)
      throw new Error('[@apeira/plugin-compact] Plugin is not initialized.')

    return agent
  }

  const getContextLength = () => getAgent().state.get().contextLength ?? DEFAULT_CONTEXT_LENGTH

  const compactHistoricalInput = async (historicalInput: readonly AgentInput[]) => {
    const contextLength = getContextLength()

    try {
      const result = await executeCompact({
        compactAgent: {
          instructions: options.compactAgent.instructions,
          runner: options.compactAgent.runner ?? getAgent().runner,
        },
        contextLength,
        input: historicalInput,
        maxRetainedUserTokens,
        preserveTurns,
      })

      if (result.summary.length === 0) {
        needsCompact = false
        return historicalInput
      }

      needsCompact = false
      compactFailures = 0
      return result.input
    }
    catch (error) {
      compactFailures++
      needsCompact = true

      if (compactFailures >= MAX_COMPACT_FAILURES) {
        compactFailures = 0
        needsCompact = false
        return hardTruncateInput(historicalInput, preserveTurns, contextLength)
      }

      console.warn('[@apeira/plugin-compact] Failed to compact context.', error)
      return historicalInput
    }
  }

  return {
    init: (nextAgent) => {
      agent = nextAgent
      unsubscribe = nextAgent.subscribe('apeira', (event) => {
        if (event.type !== 'turn.start')
          return

        stepCount = 0
      })
    },
    name,
    onFinish: (step) => {
      const totalTokens = step?.usage?.totalTokens
      const contextLength = getContextLength()
      if (totalTokens != null && totalTokens >= contextLength * threshold)
        needsCompact = true
    },
    prepareStep: async (stepOptions) => {
      const isFirstStep = stepCount === 0
      stepCount++

      if (!isFirstStep)
        return {}

      const contextLength = getContextLength()
      if (!needsCompact && estimateTokens(stepOptions.input) < contextLength * threshold)
        return {}

      const activeAgent = getAgent()
      const historicalInput = await activeAgent.storage.read()
      const liveInput = stepOptions.input.slice(historicalInput.length)
      const compactedHistoricalInput = await compactHistoricalInput(historicalInput)
      const nextInput = [...compactedHistoricalInput, ...liveInput]

      await activeAgent.storage.clear()
      await activeAgent.storage.append(...compactedHistoricalInput)

      return { input: nextInput }
    },
    stop: () => {
      unsubscribe?.()
      unsubscribe = undefined
      agent = undefined
    },
    version,
  }
}
