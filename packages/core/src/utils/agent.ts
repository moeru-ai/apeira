import type { ResponsesOptions } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { ItemParam } from '../types/base'
import type { AgentPluginOption, ExtendOptions } from '../types/plugin'
import type { AgentState } from '../types/state'
import type { AgentChannel } from './channel'
import type { AgentQueue } from './queue'

import { merge } from '@moeru/std'

import { createAgentChannel } from './channel'
import { chain, chainPrepareStep, normalizePlugins } from './plugins'
import { createAgentQueue } from './queue'
import { runner } from './runner'

export interface Agent extends AgentChannel, AgentQueue {
  getInput: () => ItemParam[]
  getState: () => AgentState
  init: () => Promise<void>
  setInput: (input: ItemParam[]) => void
  setState: (patch: Partial<AgentState>) => void
  stop: () => Promise<void>
}

export interface CreateAgentOptions {
  input?: ItemParam[]
  instructions: ((state: AgentState) => Promise<string> | string) | string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions' | 'onFinish' | 'onStepFinish' | 'postToolCall' | 'prepareStep' | 'preToolCall'>
  plugins?: AgentPluginOption[]
  state?: AgentState
}

export const createAgent = (options: CreateAgentOptions): Agent => {
  const plugins = normalizePlugins(options.plugins ?? [])
  let input = structuredClone(options.input ?? [])
  let state = structuredClone(options.state ?? {})

  const responseOptions = {
    ...options.options,
    onFinish: chain('every', plugins.map(p => p.onFinish)),
    onStepFinish: chain('every', plugins.map(p => p.onStepFinish)),
    postToolCall: chain('some', plugins.map(p => p.postToolCall)),
    prepareStep: chainPrepareStep(plugins.map(p => p.prepareStep)),
    preToolCall: chain('some', plugins.map(p => p.preToolCall)),
  }

  const channel = createAgentChannel()

  const resolveInstructions = async (opts: ExtendOptions) => {
    const base = typeof options.instructions === 'function'
      ? await options.instructions(state)
      : options.instructions

    const extensions: string[] = []
    for (const plugin of plugins) {
      const extended = await plugin.extendInstructions?.(opts)
      if (extended != null && extended !== '')
        extensions.push(extended)
    }

    return [base, ...extensions].join('\n\n')
  }

  let initPromise: Promise<void> | undefined
  let agent: Agent

  const init = async () => {
    if (initPromise)
      return initPromise

    // eslint-disable-next-line @masknet/type-no-force-cast-via-top-type
    initPromise = Promise.all(plugins.map(async p => p.init?.(agent))) as unknown as Promise<void>

    return initPromise
  }

  const getInput: Agent['getInput'] = () => structuredClone(input)

  const getState: Agent['getState'] = () => structuredClone(state)

  const setInput: Agent['setInput'] = nextInput =>
    input = structuredClone(nextInput)

  const setState: Agent['setState'] = nextState =>
    state = structuredClone(merge(state, nextState))

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
    init,
    runner: async (opts) => {
      const extendOptions: ExtendOptions = {
        signal: opts.abortSignal,
        state,
        turnId: opts.turnId,
      }

      const instructions = await resolveInstructions(extendOptions)

      const tools: Tool[] = []
      for (const plugin of plugins) {
        const extended = await plugin.extendTools?.(extendOptions)
        if (extended != null)
          tools.push(...extended)
      }

      const result = await runner({
        ...opts,
        input: [...input, ...opts.input],
        instructions,
        options: {
          ...responseOptions,
          tools: [...(options.options.tools ?? []), ...tools],
        },
      })

      input.push(...opts.input, ...result.output)

      return result
    },
  })

  const clear = () => {
    queue.clear()
    setInput(options.input ?? [])
    state = structuredClone(options.state ?? {})
    channel.emit('apeira', { turnId: crypto.randomUUID(), type: 'agent.cleared' })
  }

  agent = {
    ...channel,
    ...queue,
    clear,
    getInput,
    getState,
    init,
    setInput,
    setState,
    stop,
  }

  return agent
}
