import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { AgentEvent, ApeiraEvent } from '../types/event'
import type { AgentEventListener } from '../types/event-listener'
import type { ItemParam } from '../types/responses'

import { responses, stepCountAtLeast } from '@xsai-ext/responses'

import { linkedAbort } from './linked-abort'
import { createQueue } from './queue'

export interface Agent<T> {
  abort: (reason?: unknown) => void
  clear: () => void
  getContext: () => AgentContext<T>
  run: (input: ItemParam, signal?: AbortSignal) => ReadableStream<AgentEvent>
  send: (input: ItemParam, signal?: AbortSignal) => string
  subscribe: (eventListener: AgentEventListener) => (() => boolean)
}

export interface AgentPendingInput {
  input: ItemParam
  signal?: AbortSignal
}

export interface AgentRunningTurn {
  controller: AbortController
  id: string
  input: ItemParam
}

export interface AgentTurnJob {
  id: string
  input: ItemParam
  signal?: AbortSignal
}

export interface CreateAgentOptions<T> {
  context?: AgentContext<T>
  input?: ItemParam[]
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  name: string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}

export const createAgent = <T>(options: CreateAgentOptions<T>): Agent<T> => {
  const eventListeners = new Set<AgentEventListener>()
  const pendingTurns = createQueue<AgentTurnJob>()
  const pendingInput = createQueue<AgentPendingInput>()

  let pumping = false
  let acceptingInputTurnId: string | undefined
  let running: AgentRunningTurn | undefined
  let history: ItemParam[] = [...(options.input ?? [])]
  let historyVersion = 0

  const ctx: AgentContext<T> = options.context ?? {} as AgentContext<T>
  const getContext: Agent<T>['getContext'] = () => ctx

  const emit = (id: string, event: ApeiraEvent | XSAIEvent) => {
    for (const fn of [...eventListeners]) {
      try {
        fn({ ...event, turnId: id })
      }
      catch {}
    }
  }

  const runResponse = async (
    id: string,
    input: ItemParam[],
    controller: AbortController,
    version: number,
  ) => {
    const nextInput = [...history, ...input]

    const result = responses({
      ...options.options,
      abortSignal: controller.signal,
      input: nextInput,
      instructions: typeof options.instructions === 'function'
        ? await options.instructions(ctx)
        : options.instructions,
      stopWhen: options.options.stopWhen ?? stepCountAtLeast(20),
    })

    void result.input.catch(() => undefined)
    void result.steps.catch(() => undefined)
    void result.usage.catch(() => undefined)
    void result.totalUsage.catch(() => undefined)

    for await (const event of result.eventStream)
      emit(id, event)

    if (version === historyVersion)
      history = await result.input
  }

  const drainLivePendingInput = () =>
    Array.from(pendingInput.drain()).filter(item => item.signal?.aborted !== true)

  const runRegularTask = async ({ id, input, signal }: AgentTurnJob) => {
    const controller = linkedAbort(signal)
    const version = historyVersion

    running = {
      controller,
      id,
      input,
    }
    acceptingInputTurnId = id

    try {
      emit(id, { type: 'turn.start' })

      let nextInput = [input]

      while (true) {
        await runResponse(id, nextInput, controller, version)

        if (controller.signal.aborted)
          throw controller.signal.reason

        const drained = drainLivePendingInput()
        if (drained.length === 0)
          break

        emit(id, { count: drained.length, type: 'turn.input_drained' })
        nextInput = drained.map(item => item.input)
      }

      if (acceptingInputTurnId === id)
        acceptingInputTurnId = undefined

      emit(id, { type: 'turn.done' })
    }
    catch (error) {
      pendingInput.clear()

      if (acceptingInputTurnId === id)
        acceptingInputTurnId = undefined

      emit(id, controller.signal.aborted
        ? { reason: controller.signal.reason, type: 'turn.aborted' }
        : { error, type: 'turn.failed' })
    }
    finally {
      if (running?.id === id)
        running = undefined

      if (acceptingInputTurnId === id)
        acceptingInputTurnId = undefined
    }
  }

  const pumpTurns = async () => {
    if (pumping)
      return

    pumping = true

    try {
      while (true) {
        const job = pendingTurns.dequeue()
        if (job == null)
          break

        await runRegularTask(job)
      }
    }
    finally {
      pumping = false

      if (pendingTurns.size > 0)
        void pumpTurns()
    }
  }

  const enqueueTurn = (id: string, input: ItemParam, signal?: AbortSignal) => {
    emit(id, { type: 'turn.queued' })
    pendingTurns.enqueue({ id, input, signal })

    void pumpTurns()
  }

  const send: Agent<T>['send'] = (input, signal) => {
    const targetTurnId = acceptingInputTurnId ?? pendingTurns.peek()?.id

    if (targetTurnId != null) {
      pendingInput.enqueue({ input, signal })
      emit(targetTurnId, { type: 'turn.input_queued' })

      return targetTurnId
    }

    const id = crypto.randomUUID()

    enqueueTurn(id, input, signal)

    return id
  }

  const subscribe: Agent<T>['subscribe'] = (eventListener) => {
    eventListeners.add(eventListener)
    return () => eventListeners.delete(eventListener)
  }

  const run: Agent<T>['run'] = (input, signal) => {
    const id = crypto.randomUUID()
    let unsubscribe: (() => boolean) | undefined

    return new ReadableStream<AgentEvent>({
      cancel: () => {
        unsubscribe?.()
      },
      start: (controller) => {
        unsubscribe = subscribe((event) => {
          if (event.turnId !== id)
            return

          controller.enqueue(event)

          if (
            event.type === 'turn.aborted'
            || event.type === 'turn.done'
            || event.type === 'turn.failed'
          ) {
            unsubscribe?.()
            controller.close()
          }
        })

        enqueueTurn(id, input, signal)
      },
    })
  }

  const abort: Agent<T>['abort'] = reason =>
    running?.controller.abort(reason)

  const clear: Agent<T>['clear'] = () => {
    acceptingInputTurnId = undefined
    abort('cleared')

    pendingInput.clear()

    for (const job of pendingTurns.drain())
      emit(job.id, { reason: 'cleared', type: 'turn.aborted' })

    history = [...(options.input ?? [])]
    historyVersion += 1

    // emit(crypto.randomUUID(), { type: 'turn.clear' })
  }

  return {
    abort,
    clear,
    getContext,
    run,
    send,
    subscribe,
  }
}
