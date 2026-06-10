import type { AgentEvent } from '../types/event'
import type { AgentInput } from '../types/input'
import type { RunnerContext, RunnerResult } from '../types/runner'
import type { AgentChannel } from './channel'

import Queue from 'yocto-queue'

export interface AgentQueue {
  abort: (reason?: unknown) => void
  clear: () => void
  getActiveTurnId: () => string | undefined
  interrupt: (reason?: unknown) => string | undefined
  remove: () => Promise<void>
  send: (item: AgentInput, options?: AgentSendOptions) => string
}

export interface AgentQueueTurn {
  id: string
  input: AgentInput[]
  signal?: AbortSignal
}

export interface AgentSendOptions {
  signal?: AbortSignal
}

export interface CreateAgentQueueOptions {
  channel: AgentChannel
  init?: () => Promise<void>
  runner: (options: Pick<RunnerContext, 'abortSignal' | 'channel' | 'input' | 'turnId'>) => Promise<RunnerResult>
}

export const createAgentQueue = ({ channel, init, runner }: CreateAgentQueueOptions): AgentQueue => {
  const pendingTurns = new Queue<AgentQueueTurn>()
  const pendingInput: AgentInput[] = []
  let activeTurn: undefined | { controller: AbortController, id: string }
  let pumping = false
  let pumpReady = Promise.resolve()

  const emit = (turnId: string, event: AgentEvent) => channel.emit('apeira', { ...event, turnId })

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const runTurn = async (turn: AgentQueueTurn) => {
    const controller = new AbortController()
    const onAbort = () => controller.abort(turn.signal!.reason)

    if (turn.signal != null) {
      if (turn.signal.aborted)
        controller.abort(turn.signal.reason)
      else
        turn.signal.addEventListener('abort', onAbort, { once: true })
    }

    activeTurn = { controller, id: turn.id }

    let input = turn.input

    try {
      if (controller.signal.aborted) {
        emit(turn.id, { reason: controller.signal.reason, turnId: turn.id, type: 'turn.aborted' })
        return
      }

      await init?.()
      emit(turn.id, { turnId: turn.id, type: 'turn.start' })

      while (!controller.signal.aborted) {
        await runner({ abortSignal: controller.signal, channel, input, turnId: turn.id })

        if (pendingInput.length > 0) {
          const drained = pendingInput.splice(0)
          emit(turn.id, { count: drained.length, turnId: turn.id, type: 'turn.input_drained' })
          input = drained
          continue
        }

        break
      }

      if (activeTurn?.id === turn.id)
        activeTurn = undefined

      if (controller.signal.aborted)
        emit(turn.id, { reason: controller.signal.reason, turnId: turn.id, type: 'turn.aborted' })
      else
        emit(turn.id, { turnId: turn.id, type: 'turn.done' })
    }
    catch (error) {
      if (activeTurn?.id === turn.id)
        activeTurn = undefined

      if (controller.signal.aborted)
        emit(turn.id, { reason: controller.signal.reason, turnId: turn.id, type: 'turn.aborted' })
      else
        emit(turn.id, { error, turnId: turn.id, type: 'turn.failed' })
    }
    finally {
      if (turn.signal != null)
        turn.signal.removeEventListener('abort', onAbort)

      pendingInput.length = 0

      if (activeTurn?.id === turn.id)
        activeTurn = undefined
    }
  }

  const pump = async () => {
    if (pumping)
      return pumpReady

    pumping = true

    pumpReady = (async () => {
      try {
        for (const turn of pendingTurns.drain())
          await runTurn(turn)
      }
      finally {
        pumping = false
      }
    })()

    return pumpReady
  }

  const getActiveTurnId: AgentQueue['getActiveTurnId'] = () => activeTurn?.id

  const abort: AgentQueue['abort'] = reason => activeTurn?.controller.abort(reason)

  const clear: AgentQueue['clear'] = () => {
    activeTurn?.controller.abort('cleared')
    pendingInput.length = 0
    pendingTurns.clear()
  }

  const interrupt: AgentQueue['interrupt'] = (reason) => {
    const id = activeTurn?.id
    activeTurn?.controller.abort(reason)
    return id
  }

  const remove: AgentQueue['remove'] = async () => {
    activeTurn?.controller.abort('removed')
    pendingInput.length = 0
    await pumpReady
  }

  const send: AgentQueue['send'] = (item, options) => {
    const active = activeTurn?.controller.signal.aborted !== true ? activeTurn : undefined

    if (active) {
      pendingInput.push(item)
      emit(active.id, { turnId: active.id, type: 'turn.input_queued' })
      return active.id
    }

    const id = crypto.randomUUID()
    pendingTurns.enqueue({ id, input: [item], signal: options?.signal })
    emit(id, { turnId: id, type: 'turn.queued' })
    void pump()
    return id
  }

  return {
    abort,
    clear,
    getActiveTurnId,
    interrupt,
    remove,
    send,
  }
}
