import type { Tool } from '@xsai/shared-chat'

import type { Agent, CreateAgentOptions } from '../agent'
import type { AgentInput } from '../agent/input'
import type { AgentState } from '../agent/state'
import type { AgentStorage } from '../agent/storage'

import { createAgent } from '../agent'
import { mem } from '../agent/storage'

export interface ForkOptions {
  inheritEntries?: boolean
  init?: boolean
  initialInput?: ((parentInput: readonly AgentInput[]) => readonly AgentInput[]) | readonly AgentInput[]
  initialState?: ((parentInitialState: Readonly<AgentState>) => AgentState) | AgentState
  instructions?: CreateAgentOptions['instructions']
  plugins?: NonNullable<CreateAgentOptions['plugins']>
  runner?: CreateAgentOptions['runner']
  /** @default mem() */
  storage?: AgentStorage
  tools?: readonly Tool[]
}

export const fork = async (agent: Agent, options: ForkOptions = {}): Promise<Agent> => {
  const storage = options.storage ?? mem()

  if (options.inheritEntries !== false) {
    if (storage === agent.storage)
      throw new Error('Cannot inherit entries into the parent storage')
    await storage.append(...await agent.storage.read())
  }

  const child = createAgent({
    initialInput: typeof options.initialInput === 'function'
      ? options.initialInput(agent.initialInput)
      : (options.initialInput ?? agent.initialInput),
    initialState: typeof options.initialState === 'function'
      ? options.initialState(agent.initialState)
      : (options.initialState ?? agent.initialState),
    instructions: options.instructions ?? agent.instructions,
    plugins: options.plugins ?? agent.plugins,
    runner: options.runner ?? agent.runner,
    storage,
    tools: options.tools ?? agent.tools,
  })

  if (options.init)
    await child.init()

  return child
}
