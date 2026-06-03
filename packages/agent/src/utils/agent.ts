import type { ResponsesOptions } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { ItemParam } from '../types/base'
import type { AgentPluginOption } from '../types/plugin'
import type { AgentState } from '../types/state'
import type { AgentChannel } from './channel'
import type { AgentQueue } from './queue'

import { createAgentChannel } from './channel'
import { chain, chainPrepareStep, normalizePlugins } from './plugins'
import { createAgentQueue } from './queue'
import { runner } from './runner'

export interface Agent extends AgentChannel, AgentQueue {
  init: () => Promise<unknown>
  stop: () => Promise<void>
}

export interface CreateAgentOptions<T = unknown> {
  input?: ItemParam[]
  instructions: ((state: AgentState<T>) => Promise<string> | string) | string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions' | 'onFinish' | 'onStepFinish' | 'postToolCall' | 'prepareStep' | 'preToolCall'>
  plugins?: AgentPluginOption[]
  state?: AgentState<T>
}

export const createAgent = <T>(options: CreateAgentOptions<T>): Agent => {
  const plugins = normalizePlugins(options.plugins ?? [])
  const state = options.state ?? {} as AgentState<T>

  const responseOptions = {
    ...options.options,
    onFinish: chain('every', plugins.map(p => p.onFinish)),
    onStepFinish: chain('every', plugins.map(p => p.onStepFinish)),
    postToolCall: chain('some', plugins.map(p => p.postToolCall)),
    prepareStep: chainPrepareStep(plugins.map(p => p.prepareStep)),
    preToolCall: chain('some', plugins.map(p => p.preToolCall)),
  }

  const channel = createAgentChannel()
  const baseInput = structuredClone(options.input ?? [])

  const resolveInstructions = async () => {
    const base = typeof options.instructions === 'function'
      ? await options.instructions(state)
      : options.instructions

    const extensions: string[] = []
    for (const plugin of plugins) {
      const extended = await plugin.extendInstructions?.(state)
      if (extended != null)
        extensions.push(extended)
    }

    return [base, ...extensions].join('\n\n')
  }

  let initPromise: Promise<unknown> | undefined
  let agent: Agent

  const init = async () => {
    if (initPromise)
      return initPromise

    initPromise = Promise.all(plugins.map(async p => p.init?.(agent)))

    return initPromise
  }

  const stop = async () => {
    for (const plugin of plugins.toReversed()) {
      try {
        await plugin.stop?.()
      }
      catch {}
    }
  }

  const queue = createAgentQueue({
    channel,
    runner: async (opts) => {
      await init()
      const instructions = await resolveInstructions()

      const tools: Tool[] = []
      for (const plugin of plugins) {
        const extended = await plugin.extendTools?.(state)
        if (extended != null)
          tools.push(...extended)
      }

      return runner({
        ...opts,
        input: [...baseInput, ...opts.input],
        instructions,
        options: {
          ...responseOptions,
          tools: [...(options.options.tools ?? []), ...tools],
        },
      })
    },
  })

  agent = {
    ...channel,
    ...queue,
    init,
    stop,
  }

  return agent
}
