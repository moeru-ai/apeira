import type { Tool } from '@xsai/shared-chat'

import type { AgentEntry } from '../types/entry'
import type { AgentPluginOption, ExtendOptions } from '../types/plugin'
import type { Runner } from '../types/runner'
import type { AgentState } from '../types/state'
import type { AgentStorage } from '../types/storage'
import type { AgentChannel } from './channel'
import type { AgentQueue } from './queue'
import type { AgentStateManager } from './state-manager'

import { entry, toAgentInput } from '../utils/entry'
import { createAgentChannel } from './channel'
import { developer } from './input'
import { chain, chainPrepareStep, normalizePlugins } from './plugin'
import { createAgentQueue } from './queue'
import { createAgentStateManager } from './state-manager'
import { mem } from './storage'

export interface Agent extends AgentChannel, AgentQueue {
  init: () => Promise<void>
  readonly instructions: CreateAgentOptions['instructions']
  interrupt: (reason?: unknown) => Promise<string | undefined>
  readonly plugins: AgentPluginOption[]
  reset: () => Promise<void>
  readonly runner: Runner
  readonly state: Readonly<AgentStateManager>
  stop: () => Promise<void>
  readonly storage: AgentStorage
}

export interface CreateAgentOptions {
  instructions: ((state: Readonly<AgentState>) => Promise<string> | string) | string
  plugins?: AgentPluginOption[]
  runner: Runner
  state?: AgentState
  /** @default `mem()` */
  storage?: AgentStorage
}

export const createAgent = (options: CreateAgentOptions): Agent => {
  const plugins = normalizePlugins(options.plugins ?? [])
  const storage = options.storage ?? mem()

  const hooks = {
    onFinish: chain('every', plugins.map(p => p.onFinish)),
    onStepFinish: chain('every', plugins.map(p => p.onStepFinish)),
    postToolCall: chain('some', plugins.map(p => p.postToolCall)),
    prepareStep: chainPrepareStep(plugins.map(p => p.prepareStep)),
    preToolCall: chain('some', plugins.map(p => p.preToolCall)),
  }

  let storageReady = Promise.resolve()

  const mutateStorage = async (operation: () => Promise<void>) => {
    const result = storageReady.then(operation, operation)
    storageReady = result.catch(() => {})
    return result
  }

  const channel = createAgentChannel({
    persist: async (event, opts) => opts?.save
      ? mutateStorage(async () => storage.append(entry('event', event as AgentEntry<'event'>['data'])))
      : undefined,
  })

  const state = createAgentStateManager(options.state ?? {}, next => void mutateStorage(async () => storage.append(entry('state', next))))

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

      const history = toAgentInput(await storage.read())

      const result = await options.runner({
        ...opts,
        ...hooks,
        input: [...history, ...opts.input],
        instructions,
        tools,
      })

      if (!opts.abortSignal?.aborted) {
        await mutateStorage(async () => storage.append(
          ...opts.input.map(data => entry('input', data)),
          ...result.output.map(data => entry('input', data)),
        ))
      }

      return result
    },
  })

  const interrupt: Agent['interrupt'] = async (reason) => {
    const turnId = queue.interrupt(reason)

    if (turnId != null) {
      await mutateStorage(async () => storage.append(entry('input', developer([
        '<turn_aborted>',
        'The previous turn was interrupted on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.',
        '</turn_aborted>',
      ].join('\n')))))
    }

    return turnId
  }

  const reset: Agent['reset'] = async () => {
    await queue.clear()
    await mutateStorage(async () => storage.reset())
    state.set(options.state ?? {})
    await channel.emit('apeira', { turnId: crypto.randomUUID(), type: 'agent.reset' }, { save: true })
  }

  agent = {
    ...channel,
    ...queue,
    init,
    instructions: options.instructions,
    interrupt,
    plugins: options.plugins ?? [],
    reset,
    runner: options.runner,
    state,
    stop,
    storage,
  }

  return agent
}
