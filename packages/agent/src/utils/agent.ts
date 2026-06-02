import type { ResponsesOptions } from '@xsai-ext/responses'

import type { ItemParam } from '../types/base'
import type { AgentPlugin } from '../types/plugin'
import type { AgentState } from '../types/state'
import type { AgentChannel } from './channel'
import type { AgentQueue } from './queue'

import { createAgentChannel } from './channel'
import { chain, chainPrepareStep, sortPlugins } from './plugins'
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
  plugins?: AgentPlugin[]
  state?: AgentState<T>
}

export const createAgent = <T>(options: CreateAgentOptions<T>): Agent => {
  const plugins = sortPlugins(options.plugins ?? [])

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

  const resolveInstructions = async () =>
    typeof options.instructions === 'function'
      ? options.instructions(options.state ?? {} as AgentState<T>)
      : options.instructions

  let initPromise: Promise<unknown> | undefined
  let agent: Agent

  const init = async () => {
    if (initPromise)
      return initPromise

    initPromise = Promise.all(plugins.map(async p => p.init?.(agent)))

    return initPromise
  }

  const queue = createAgentQueue({
    channel,
    run: async (opts) => {
      await init()
      return runner({
        ...opts,
        input: [...baseInput, ...opts.input],
        instructions: await resolveInstructions(),
        options: responseOptions,
      })
    },
  })

  agent = {
    ...channel,
    ...queue,
    init,
    stop: async () => {
      for (let i = plugins.length - 1; i >= 0; i--) {
        try {
          await plugins[i].stop?.()
        }
        catch {}
      }
    },
  }

  return agent
}
