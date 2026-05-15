import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { ApeiraEvent } from '../types/event'
import type { ItemParam } from '../types/responses'
import type { ThreadStore } from './thread-store'

import { merge } from '@moeru/std/merge'
import { responses, stepCountAtLeast } from '@xsai-ext/responses'

export type EmitTurnEvent = (id: string, event: ApeiraEvent | XSAIEvent) => void

export interface QueuedInput<T> {
  context?: Partial<AgentContext<T>>
  input: ItemParam
  signal?: AbortSignal
}

export interface QueuedTurn<T = unknown> {
  context?: Partial<AgentContext<T>>
  id: string
  input: ItemParam
  signal?: AbortSignal
}

export interface RunTurnOptions<T> {
  controller: AbortController
  drainInput: () => QueuedInput<T>[]
  turn: QueuedTurn<T>
}

export type RunTurnParams<T> = RunTurnOptions<T> & TurnOptions<T>

export type TurnCompletion
  = | { error: unknown, type: 'failed' }
    | { reason?: unknown, type: 'aborted' }
    | { type: 'done' }

export interface TurnOptions<T> {
  emit: EmitTurnEvent
  getContext: (context?: Partial<AgentContext<T>>) => AgentContext<T>
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  thread: ThreadStore
}

const mergeRunContext = <T>(
  context: AgentContext<T>,
  input: Array<QueuedInput<T> | QueuedTurn<T>>,
): AgentContext<T> =>
  input.reduce<AgentContext<T>>(
    (current, item) => merge(current, item.context),
    context,
  )

const runResponse = async <T>(
  options: RunTurnParams<T>,
  input: Array<QueuedInput<T> | QueuedTurn<T>>,
) => {
  const snapshot = options.thread.snapshot()
  const responseInput = [...snapshot.items, ...input.map(item => item.input)]
  const context = mergeRunContext(options.getContext(), input)

  const result = responses({
    ...options.responseOptions,
    abortSignal: options.controller.signal,
    input: responseInput,
    instructions: typeof options.instructions === 'function'
      ? await options.instructions(context)
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

  options.thread.commit(snapshot.version, resolvedInput)
}

export const runTurn = async <T>(options: RunTurnParams<T>): Promise<TurnCompletion> => {
  try {
    options.emit(options.turn.id, { type: 'turn.start' })

    let nextInput: Array<QueuedInput<T> | QueuedTurn<T>> = [options.turn]

    while (true) {
      await runResponse(options, nextInput)

      if (options.controller.signal.aborted)
        throw options.controller.signal.reason

      const drained = options.drainInput()
      if (drained.length === 0)
        break

      options.emit(options.turn.id, { count: drained.length, type: 'turn.input_drained' })
      nextInput = drained
    }

    return { type: 'done' }
  }
  catch (error) {
    if (options.controller.signal.aborted)
      return { reason: options.controller.signal.reason, type: 'aborted' }

    return { error, type: 'failed' }
  }
}
