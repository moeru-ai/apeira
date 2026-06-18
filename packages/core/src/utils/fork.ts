import type { MaybePromise } from '../types/base'
import type { AgentEntry } from '../types/entry'
import type { AgentState } from '../types/state'
import type { AgentStorage } from '../types/storage'
import type { Agent, CreateAgentOptions } from './agent'

import { createAgent } from './agent'
import { mem } from './storage'

export interface ForkOptions {
  init?: boolean
  initialState?: ((parentState: Readonly<AgentState>) => AgentState) | AgentState
  instructions?: CreateAgentOptions['instructions']
  plugins?: CreateAgentOptions['plugins']
  runner?: CreateAgentOptions['runner']
  /** @default mem(await agent.storage.read()) */
  storage?: ((parentEntries: readonly AgentEntry[]) => MaybePromise<AgentStorage>) | AgentStorage
}

export const fork = async (agent: Agent, options: ForkOptions = {}): Promise<Agent> => {
  const parentEntries = (await agent.storage.read()).filter(e => e.type !== 'state')
  const parentState = agent.state.get()

  const child = createAgent({
    initialState: typeof options.initialState === 'function'
      ? options.initialState(parentState)
      : (options.initialState ?? parentState),
    instructions: options.instructions ?? agent.instructions,
    plugins: options.plugins ?? agent.plugins,
    runner: options.runner ?? agent.runner,
    storage: options.storage != null
      ? (typeof options.storage === 'function'
          ? await options.storage(parentEntries)
          : options.storage)
      : mem(parentEntries),
  })

  if (options.init)
    await child.init()

  return child
}
