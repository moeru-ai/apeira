import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { ApeiraEvent } from '../types/event'
import type { ItemParam } from '../types/responses'

import { responses, stepCountAtLeast } from '@xsai-ext/responses'

export type EmitTurnEvent = (id: string, event: ApeiraEvent | XSAIEvent) => void

export interface QueuedInput {
  input: ItemParam
  signal?: AbortSignal
}

export interface QueuedTurn {
  id: string
  input: ItemParam
  signal?: AbortSignal
}

export interface ResponseHistory {
  items: ItemParam[]
  version: number
}

export interface RunTurnOptions {
  controller: AbortController
  drainInput: () => QueuedInput[]
  turn: QueuedTurn
  version: number
}

export type RunTurnParams<T> = RunTurnOptions & TurnOptions<T>

export type TurnCompletion
  = | { error: unknown, type: 'failed' }
    | { reason?: unknown, type: 'aborted' }
    | { type: 'done' }

export interface TurnOptions<T> {
  context: AgentContext<T>
  emit: EmitTurnEvent
  history: ResponseHistory
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}

const runResponse = async <T>(
  options: RunTurnParams<T>,
  input: ItemParam[],
) => {
  const responseInput = [...options.history.items, ...input]

  const result = responses({
    ...options.responseOptions,
    abortSignal: options.controller.signal,
    input: responseInput,
    instructions: typeof options.instructions === 'function'
      ? await options.instructions(options.context)
      : options.instructions,
    stopWhen: options.responseOptions.stopWhen ?? stepCountAtLeast(20),
  })

  void result.input.catch(() => undefined)
  void result.steps.catch(() => undefined)
  void result.usage.catch(() => undefined)
  void result.totalUsage.catch(() => undefined)

  for await (const event of result.eventStream)
    options.emit(options.turn.id, event)

  const resolvedInput = await result.input

  if (options.version === options.history.version)
    options.history.items = resolvedInput
}

export const runTurn = async <T>(options: RunTurnParams<T>): Promise<TurnCompletion> => {
  try {
    options.emit(options.turn.id, { type: 'turn.start' })

    let nextInput = [options.turn.input]

    while (true) {
      await runResponse(options, nextInput)

      if (options.controller.signal.aborted)
        throw options.controller.signal.reason

      const drained = options.drainInput()
      if (drained.length === 0)
        break

      options.emit(options.turn.id, { count: drained.length, type: 'turn.input_drained' })
      nextInput = drained.map(item => item.input)
    }

    return { type: 'done' }
  }
  catch (error) {
    if (options.controller.signal.aborted)
      return { reason: options.controller.signal.reason, type: 'aborted' }

    return { error, type: 'failed' }
  }
}
