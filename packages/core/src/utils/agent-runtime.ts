import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { ItemParam } from '../types/responses'
import type { EmitTurnEvent, QueuedInput, QueuedTurn, TurnCompletion, TurnOptions } from './turn-runner'

import { linkedAbort } from './linked-abort'
import { createPendingInput } from './pending-input'
import { createQueue } from './queue'
import { createThreadStore } from './thread-store'
import { runTurn } from './turn-runner'

export interface AgentRuntime<T = unknown> {
  abort: (reason?: unknown) => void
  clear: () => void
  enqueueTurn: (turn: QueuedTurn<T>) => void
  interrupt: (input: QueuedInput<T>, reason?: unknown) => string
  send: (input: QueuedInput<T>) => string
}

export interface AgentRuntimeOptions<T> {
  emit: EmitTurnEvent
  getContext: (context?: Partial<AgentContext<T>>) => AgentContext<T>
  input?: ItemParam[]
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}

interface ActiveTurn {
  controller: AbortController
  id: string
  input: ItemParam
}

const createTurnAbortedBoundary = (): ItemParam => ({
  content: '<turn_aborted>\nThe previous turn was interrupted on purpose. Any tool calls that were running may have partially executed.\n</turn_aborted>',
  role: 'user',
  type: 'message',
})

export const createAgentRuntime = <T>(options: AgentRuntimeOptions<T>): AgentRuntime<T> => {
  const initialInput = [...(options.input ?? [])]
  const pendingInput = createPendingInput<T>()
  const pendingTurns = createQueue<QueuedTurn<T>>()
  const thread = createThreadStore(initialInput)

  const turnOptions: TurnOptions<T> = {
    emit: options.emit,
    getContext: options.getContext,
    instructions: options.instructions,
    responseOptions: options.responseOptions,
    thread,
  }

  let acceptingInputTurnId: string | undefined
  let activeTurn: ActiveTurn | undefined
  let pumping = false

  const abort: AgentRuntime<T>['abort'] = reason =>
    activeTurn?.controller.abort(reason)

  const clear: AgentRuntime<T>['clear'] = () => {
    acceptingInputTurnId = undefined
    abort('cleared')

    pendingInput.clear()

    for (const turn of pendingTurns.drain())
      options.emit(turn.id, { reason: 'cleared', type: 'turn.aborted' })

    thread.reset()
  }

  const completeTurn = (id: string, completion: TurnCompletion) => {
    pendingInput.delete(id)

    if (completion.type === 'done') {
      options.emit(id, { type: 'turn.done' })
      return
    }

    if (completion.type === 'aborted') {
      options.emit(id, { reason: completion.reason, type: 'turn.aborted' })
      return
    }

    options.emit(id, { error: completion.error, type: 'turn.failed' })
  }

  const abortQueuedTurn = (turn: QueuedTurn<T>) =>
    completeTurn(turn.id, {
      reason: turn.signal?.reason,
      type: 'aborted',
    })

  const pruneAbortedPendingTurns = () => {
    let targetTurnId: string | undefined
    const turns = Array.from(pendingTurns.drain())

    for (const turn of turns) {
      if (turn.signal?.aborted === true) {
        abortQueuedTurn(turn)
        continue
      }

      targetTurnId ??= turn.id
      pendingTurns.enqueue(turn)
    }

    return targetTurnId
  }

  const runQueuedTurn = async (turn: QueuedTurn<T>) => {
    if (turn.signal?.aborted === true) {
      abortQueuedTurn(turn)
      return
    }

    const controller = linkedAbort(turn.signal)
    let completion: TurnCompletion = {
      error: new Error('Turn did not complete.'),
      type: 'failed',
    }

    activeTurn = {
      controller,
      id: turn.id,
      input: turn.input,
    }
    acceptingInputTurnId = turn.id

    try {
      completion = await runTurn({
        ...turnOptions,
        controller,
        drainInput: () => pendingInput.drain(turn.id),
        turn,
      })
    }
    catch (error) {
      completion = controller.signal.aborted
        ? { reason: controller.signal.reason, type: 'aborted' }
        : { error, type: 'failed' }
    }
    finally {
      if (activeTurn?.id === turn.id)
        activeTurn = undefined

      if (acceptingInputTurnId === turn.id)
        acceptingInputTurnId = undefined
    }

    completeTurn(turn.id, completion)
  }

  const pumpTurns = async () => {
    if (pumping)
      return

    pumping = true

    try {
      while (true) {
        const turn = pendingTurns.dequeue()
        if (turn == null)
          break

        await runQueuedTurn(turn)
      }
    }
    finally {
      pumping = false

      if (pendingTurns.size > 0)
        void pumpTurns()
    }
  }

  const enqueueTurn = (turn: QueuedTurn<T>) => {
    options.emit(turn.id, { type: 'turn.queued' })
    pendingTurns.enqueue(turn)

    void pumpTurns()
  }

  const send = (input: QueuedInput<T>) => {
    const activeTurnId = activeTurn?.controller.signal.aborted === true
      ? undefined
      : acceptingInputTurnId
    const targetTurnId = activeTurnId ?? pruneAbortedPendingTurns()

    if (targetTurnId != null) {
      pendingInput.enqueue(targetTurnId, input)
      options.emit(targetTurnId, { type: 'turn.input_queued' })

      return targetTurnId
    }

    const id = crypto.randomUUID()

    enqueueTurn({ ...input, id })

    return id
  }

  const interrupt = (input: QueuedInput<T>, reason: unknown = 'interrupted') => {
    const turn = activeTurn

    if (turn != null && turn.controller.signal.aborted !== true) {
      thread.append([createTurnAbortedBoundary()])
      turn.controller.abort(reason)
    }

    return send(input)
  }

  return {
    abort,
    clear,
    enqueueTurn,
    interrupt,
    send,
  }
}
