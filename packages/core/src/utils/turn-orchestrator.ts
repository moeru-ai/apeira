import type { EmitTurnEvent, QueuedInput, TurnCompletion } from './turn-runner'

import Queue from 'yocto-queue'

import { linkedAbort } from './linked-abort'

export interface TurnOrchestrator<T> {
  abort: (reason?: unknown) => void
  clear: () => void
  enqueueTurn: (turn: QueuedInput<T> & { id: string }) => void
  interrupt: (reason?: unknown) => string | undefined
  remove: () => Promise<void>
  send: (input: QueuedInput<T>) => string
}

export interface TurnOrchestratorOptions<T> {
  emit: EmitTurnEvent
  executeTurn: (
    turn: QueuedInput<T> & { id: string },
    controller: AbortController,
    drainInput: () => QueuedInput<T>[],
  ) => Promise<TurnCompletion<T>>
  onTurnDone?: (completion: TurnCompletion<T>) => Promise<void> | void
}

export const createTurnOrchestrator = <T>(
  options: TurnOrchestratorOptions<T>,
): TurnOrchestrator<T> => {
  const pendingTurns = new Queue<QueuedInput<T> & { id: string }>()
  const pendingInput = new Map<string, Queue<QueuedInput<T>>>()
  let activeTurn: undefined | { controller: AbortController, id: string }
  let acceptingInputTurnId: string | undefined
  let pumping = false
  let pumpReady = Promise.resolve()

  const drainInput = (turnId: string): QueuedInput<T>[] => {
    const queue = pendingInput.get(turnId)
    pendingInput.delete(turnId)
    return queue == null
      ? []
      : Array.from(queue.drain()).filter(item => item.signal?.aborted !== true)
  }

  const complete = (id: string, completion: TurnCompletion) => {
    pendingInput.delete(id)
    options.emit(id, completion.type === 'done'
      ? { type: 'turn.done' }
      : completion.type === 'aborted'
        ? { reason: completion.reason, type: 'turn.aborted' }
        : { error: completion.error, type: 'turn.failed' })
  }

  const runQueued = async (turn: QueuedInput<T> & { id: string }) => {
    if (turn.signal?.aborted === true)
      return complete(turn.id, { reason: turn.signal.reason, type: 'aborted' })

    const controller = linkedAbort(turn.signal)
    activeTurn = { controller, id: turn.id }
    acceptingInputTurnId = turn.id

    let completion: TurnCompletion<T>
    try {
      completion = controller.signal.aborted
        ? { reason: controller.signal.reason, type: 'aborted' }
        : await options.executeTurn(turn, controller, () => drainInput(turn.id))
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

    if (completion.type === 'done') {
      try {
        await options.onTurnDone?.(completion)
      }
      catch {
        completion = { error: new Error('onTurnDone failed'), type: 'failed' }
      }
    }

    complete(turn.id, completion)
  }

  const pump = async () => {
    if (pumping)
      return pumpReady
    pumping = true

    const start = async () => {
      do {
        const turn = pendingTurns.dequeue()
        if (turn == null)
          break
        await runQueued(turn)
      } while (pendingTurns.size > 0)
    }

    pumpReady = start().finally(() => {
      pumping = false
      if (pendingTurns.size > 0)
        void pump()
    })

    return pumpReady
  }

  const pruneAborted = () => {
    while (pendingTurns.size > 0) {
      const turn = pendingTurns.peek()
      if (turn?.signal?.aborted !== true)
        return turn?.id
      pendingTurns.dequeue()
      complete(turn.id, { reason: turn.signal?.reason, type: 'aborted' })
    }
  }

  const abortQueued = (reason: unknown) => {
    for (const turn of pendingTurns.drain())
      complete(turn.id, { reason, type: 'aborted' })
  }

  return {
    abort: reason => activeTurn?.controller.abort(reason),
    clear: () => {
      activeTurn?.controller.abort('cleared')
      pendingInput.clear()
      abortQueued('cleared')
    },
    enqueueTurn: (turn) => {
      options.emit(turn.id, { type: 'turn.queued' })
      pendingTurns.enqueue(turn)
      void pump()
    },
    interrupt: (reason) => {
      const turn = activeTurn
      if (turn != null && turn.controller.signal.aborted !== true) {
        turn.controller.abort(reason)
        return turn.id
      }
      return undefined
    },
    remove: async () => {
      activeTurn?.controller.abort('removed')
      pendingInput.clear()
      abortQueued('removed')
      await pumpReady
    },
    send: (input) => {
      const activeTurnId = activeTurn?.controller.signal.aborted === true
        ? undefined
        : acceptingInputTurnId
      const targetTurnId = activeTurnId ?? pruneAborted()

      if (targetTurnId != null) {
        let queue = pendingInput.get(targetTurnId)
        if (queue == null) {
          queue = new Queue<QueuedInput<T>>()
          pendingInput.set(targetTurnId, queue)
        }
        queue.enqueue(input)
        options.emit(targetTurnId, { type: 'turn.input_queued' })
        return targetTurnId
      }

      const id = crypto.randomUUID()
      pendingTurns.enqueue({ ...input, id })
      options.emit(id, { type: 'turn.queued' })
      void pump()
      return id
    },
  }
}
