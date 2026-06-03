import type { ResponsesOptions, Usage } from '@xsai-ext/responses'

import type { ItemParam } from '../types/base'
import type { AgentChannel } from './channel'

import { responses, stepCountAtLeast } from '@xsai-ext/responses'

export interface RunnerOptions {
  abortSignal?: AbortSignal
  channel: AgentChannel
  input: ItemParam[]
  instructions: string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  turnId: string
}

export interface RunnerResult {
  output: ItemParam[]
  usage?: Usage
}

export const runner = async ({ abortSignal, channel, input, instructions, options, turnId }: RunnerOptions): Promise<RunnerResult> => {
  const inputLength = input.length

  const result = responses({
    ...options,
    abortSignal,
    input,
    instructions,
    stopWhen: options.stopWhen ?? stepCountAtLeast(20),
  })

  for (const p of [result.input, result.steps, result.usage, result.totalUsage] as const)
    void p.catch(() => undefined)

  for await (const event of result.eventStream) {
    channel.emit('apeira', {
      ...event,
      turnId,
    })
  }

  const output = (await result.input).slice(inputLength)
  const usage = await result.totalUsage.catch(() => undefined)

  return { output, usage }
}
