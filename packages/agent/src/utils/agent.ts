import type { ResponsesOptions } from '@xsai-ext/responses'

import type { ItemParam } from '../types/base'
import type { AgentState } from '../types/state'
import type { AgentChannel } from './channel'
import type { AgentQueue } from './queue'

import { createAgentChannel } from './channel'
import { createAgentQueue } from './queue'
import { runner } from './runner'

// eslint-disable-next-line unused-imports/no-unused-vars
export interface Agent<T> extends AgentChannel, AgentQueue {}

export interface CreateAgentOptions<T = unknown> {
  input?: ItemParam[]
  instructions: ((state: AgentState<T>) => Promise<string> | string) | string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  state?: AgentState<T>
}

export const createAgent = <T>(options: CreateAgentOptions<T>): Agent<T> => {
  const channel = createAgentChannel()
  const baseInput = structuredClone(options.input ?? [])

  const resolveInstructions = async () =>
    typeof options.instructions === 'function'
      ? options.instructions(options.state ?? {} as AgentState<T>)
      : options.instructions

  const queue = createAgentQueue({
    channel,
    run: async opts => runner({
      ...opts,
      input: [...baseInput, ...opts.input],
      instructions: await resolveInstructions(),
      options: options.options,
    }),
  })

  return {
    ...channel,
    ...queue,
  }
}
