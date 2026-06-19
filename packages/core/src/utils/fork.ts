import type { AgentInput } from '../types/input'
import type { AgentState } from '../types/state'
import type { AgentStorage } from '../types/storage'
import type { Agent, CreateAgentOptions } from './agent'

import { createAgent } from './agent'
import { mem } from './storage'

export interface ForkOptions {
  inheritEntries?: boolean
  init?: boolean
  initialInput?: ((parentInput: readonly AgentInput[]) => readonly AgentInput[]) | readonly AgentInput[]
  initialState?: ((parentState: Readonly<AgentState>) => AgentState) | AgentState
  instructions?: CreateAgentOptions['instructions']
  plugins?: CreateAgentOptions['plugins']
  runner?: CreateAgentOptions['runner']
  /** @default mem() */
  storage?: AgentStorage
}

export const fork = async (agent: Agent, options: ForkOptions = {}): Promise<Agent> => {
  const parentState = agent.state.get()
  const storage = options.storage ?? mem()

  if (options.inheritEntries !== false) {
    if (storage === agent.storage)
      throw new Error('Cannot inherit entries into the parent storage')
    const parentEntries = (await agent.storage.read()).filter(e => e.type !== 'state')
    await storage.append(...parentEntries)
  }

  const child = createAgent({
    initialInput: typeof options.initialInput === 'function'
      ? options.initialInput(agent.initialInput)
      : (options.initialInput ?? agent.initialInput),
    initialState: typeof options.initialState === 'function'
      ? options.initialState(parentState)
      : (options.initialState ?? parentState),
    instructions: options.instructions ?? agent.instructions,
    plugins: options.plugins ?? agent.plugins,
    runner: options.runner ?? agent.runner,
    storage,
  })

  if (options.init)
    await child.init()

  return child
}
