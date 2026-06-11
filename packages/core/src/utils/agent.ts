import type { Tool } from '@xsai/shared-chat'

import type { AgentInput } from '../types/input'
import type { AgentPluginOption, ExtendOptions } from '../types/plugin'
import type { Runner } from '../types/runner'
import type { AgentState } from '../types/state'
import type { AgentChannel } from './channel'
import type { AgentQueue } from './queue'
import type { AgentStateManager } from './state-manager'

import { createAgentChannel } from './channel'
import { developer } from './input'
import { chain, chainPrepareStep, normalizePlugins } from './plugins'
import { createAgentQueue } from './queue'
import { createAgentStateManager } from './state-manager'

export interface Agent extends AgentChannel, AgentQueue {
  getInput: () => readonly AgentInput[]
  init: () => Promise<void>
  setInput: (input: readonly AgentInput[]) => void
  state: Readonly<AgentStateManager>
  stop: () => Promise<void>
}

export interface CreateAgentOptions {
  input?: readonly AgentInput[]
  instructions: ((state: Readonly<AgentState>) => Promise<string> | string) | string
  plugins?: AgentPluginOption[]
  runner: Runner
  state?: AgentState
}

export const createAgent = (options: CreateAgentOptions): Agent => {
  const plugins = normalizePlugins(options.plugins ?? [])
  let input: AgentInput[] = structuredClone(options.input ?? []) as AgentInput[]

  const hooks = {
    onFinish: chain('every', plugins.map(p => p.onFinish)),
    onStepFinish: chain('every', plugins.map(p => p.onStepFinish)),
    postToolCall: chain('some', plugins.map(p => p.postToolCall)),
    prepareStep: chainPrepareStep(plugins.map(p => p.prepareStep)),
    preToolCall: chain('some', plugins.map(p => p.preToolCall)),
  }

  const channel = createAgentChannel()

  const state = createAgentStateManager(options.state ?? {})

  const resolveInstructions = async (opts: ExtendOptions) => {
    const base = typeof options.instructions === 'function'
      ? await options.instructions(state.get())
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

  const getInput: Agent['getInput'] = () => input

  const setInput: Agent['setInput'] = nextInput =>
    input = structuredClone(nextInput) as AgentInput[]

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
        state: state.get(),
        turnId: opts.turnId,
      }

      const instructions = await resolveInstructions(extendOptions)

      const tools: Tool[] = []
      for (const plugin of plugins) {
        const extended = await plugin.extendTools?.(extendOptions)
        if (extended != null)
          tools.push(...extended)
      }

      const result = await options.runner({
        ...opts,
        ...hooks,
        input: [...input, ...opts.input],
        instructions,
        tools,
      })

      if (!opts.abortSignal?.aborted)
        input.push(...opts.input, ...result.output)

      return result
    },
  })

  const interrupt: Agent['interrupt'] = (reason) => {
    const turnId = queue.interrupt(reason)

    if (turnId != null) {
      input.push(developer([
        '<turn_aborted>',
        'The previous turn was interrupted on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.',
        '</turn_aborted>',
      ].join('\n')))
    }

    return turnId
  }

  const clear = () => {
    queue.clear()
    setInput(options.input ?? [])
    state.set(options.state ?? {})
    channel.emit('apeira', { turnId: crypto.randomUUID(), type: 'agent.cleared' })
  }

  agent = {
    ...channel,
    ...queue,
    clear,
    getInput,
    init,
    interrupt,
    setInput,
    state,
    stop,
  }

  return agent
}
