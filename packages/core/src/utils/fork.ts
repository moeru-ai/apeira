import type { MaybePromise } from '../types/base'
import type { AgentInput } from '../types/input'
import type { AgentState } from '../types/state'
import type { AgentStorage } from '../types/storage'
import type { Agent, CreateAgentOptions } from './agent'

import { createAgent } from './agent'
import { mem } from './storage'

export interface ForkOptions {
  init?: boolean
  input?: readonly AgentInput[]
  instructions?: CreateAgentOptions['instructions']
  plugins?: CreateAgentOptions['plugins']
  runner?: CreateAgentOptions['runner']
  state?: ((parent: Readonly<AgentState>) => AgentState) | AgentState
  storage?: ((snapshot: readonly AgentInput[]) => MaybePromise<AgentStorage>) | AgentStorage
}

export const fork = async (parent: Agent, options: ForkOptions = {}): Promise<Agent> => {
  const snapshot = await parent.storage.read()
  const input = options.input != null
    ? structuredClone(options.input)
    : structuredClone(snapshot)

  const nextStorage = options.storage != null
    ? (typeof options.storage === 'function'
        ? await options.storage(input)
        : options.storage)
    : mem(input)

  const parentState = parent.state.get()
  const nextState = typeof options.state === 'function'
    ? options.state(parentState)
    : (options.state ?? structuredClone(parentState))

  const child = createAgent({
    instructions: options.instructions ?? parent.instructions,
    plugins: options.plugins ?? parent.plugins,
    runner: options.runner ?? parent.runner,
    state: nextState,
    storage: nextStorage,
  })

  if (options.init)
    await child.init()

  return child
}
