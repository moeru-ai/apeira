import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { ItemParam } from '../types/responses'
import type { EmitTurnEvent, QueuedTurn, TurnCompletion, TurnOptions } from './turn-runner'

import { linkedAbort } from './linked-abort'
import { createPendingInput } from './pending-input'
import { createQueue } from './queue'
import { createThreadStore } from './thread-store'
import { runTurn } from './turn-runner'

export interface AgentRuntime {
  abort: (reason?: unknown) => void
  clear: () => void
  enqueueTurn: (id: string, input: ItemParam, signal?: AbortSignal) => void
  interrupt: (input: ItemParam, reason?: unknown, signal?: AbortSignal) => string
  send: (input: ItemParam, signal?: AbortSignal) => string
}

export interface AgentRuntimeOptions<T> {
  context: AgentContext<T>
  emit: EmitTurnEvent
  input?: ItemParam[]
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}

interface ActiveTurn {
  controller: AbortController
  id: string
  input: ItemParam
}

export const createAgentRuntime = <T>(options: AgentRuntimeOptions<T>): AgentRuntime => {
  const initialInput = [...(options.input ?? [])]
  const pendingInput = createPendingInput()
  const pendingTurns = createQueue<QueuedTurn>()
  const thread = createThreadStore(initialInput)

  const turnOptions: TurnOptions<T> = {
    context: options.context,
    emit: options.emit,
    instructions: options.instructions,
    responseOptions: options.responseOptions,
    thread,
  }

  let acceptingInputTurnId: string | undefined
  let activeTurn: ActiveTurn | undefined
  let pumping = false

  const abort: AgentRuntime['abort'] = reason =>
    activeTurn?.controller.abort(reason)

  const clear: AgentRuntime['clear'] = () => {
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

  const runQueuedTurn = async (turn: QueuedTurn) => {
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

  const enqueueTurn: AgentRuntime['enqueueTurn'] = (id, input, signal) => {
    options.emit(id, { type: 'turn.queued' })
    pendingTurns.enqueue({ id, input, signal })

    void pumpTurns()
  }

  const send: AgentRuntime['send'] = (input, signal) => {
    const activeTurnId = activeTurn?.controller.signal.aborted === true
      ? undefined
      : acceptingInputTurnId
    const targetTurnId = activeTurnId ?? pendingTurns.peek()?.id

    if (targetTurnId != null) {
      pendingInput.enqueue(targetTurnId, { input, signal })
      options.emit(targetTurnId, { type: 'turn.input_queued' })

      return targetTurnId
    }

    const id = crypto.randomUUID()

    enqueueTurn(id, input, signal)

    return id
  }

  const interrupt: AgentRuntime['interrupt'] = (input, reason = 'interrupted', signal) => {
    const turn = activeTurn

    if (turn != null && turn.controller.signal.aborted !== true) {
      options.emit(turn.id, { reason, type: 'turn.interrupted' })
      turn.controller.abort(reason)
    }

    return send(input, signal)
  }

  return {
    abort,
    clear,
    enqueueTurn,
    interrupt,
    send,
  }
}
