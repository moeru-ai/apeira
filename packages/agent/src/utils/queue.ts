import type { ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { AgentChannel } from './channel'
import type { RunnerOptions, RunnerResult } from './runner'

import Queue from 'yocto-queue'

export interface AgentQueue {
  abort: (reason?: unknown) => void
  clear: () => void
  interrupt: (reason?: unknown) => string | undefined
  remove: () => Promise<void>
  send: (item: ItemParam, options?: AgentSendOptions) => string
}

export interface AgentSendOptions {
  mode?: 'later' | 'now'
  signal?: AbortSignal
}

export interface CreateAgentQueueOptions {
  channel: AgentChannel
  run: (options: Omit<RunnerOptions, 'instructions' | 'options'>) => Promise<RunnerResult>
}

export const createAgentQueue = (options: CreateAgentQueueOptions): AgentQueue => {
  const pendingTurns = new Queue<{ id: string, input: ItemParam[], signal?: AbortSignal }>()
  const pendingInput: ItemParam[] = []
  const pendingNextInput: ItemParam[] = []
  let activeTurn: undefined | { controller: AbortController, id: string }
  let pumping = false
  let pumpReady = Promise.resolve()

  const { channel, run } = options

  const emit = (turnId: string, event: AgentEvent) => channel.emit('apeira', { ...event, turnId })

  const runTurn = async (turn: { id: string, input: ItemParam[], signal?: AbortSignal }) => {
    const controller = new AbortController()
    if (turn.signal)
      turn.signal.addEventListener('abort', () => controller.abort(turn.signal!.reason), { once: true })

    activeTurn = { controller, id: turn.id }
    emit(turn.id, { turnId: turn.id, type: 'turn.start' })

    let input = turn.input

    try {
      while (!controller.signal.aborted) {
        await run({ abortSignal: controller.signal, channel, input, turnId: turn.id })

        if (pendingInput.length > 0) {
          const drained = pendingInput.splice(0)
          emit(turn.id, { count: drained.length, turnId: turn.id, type: 'turn.input_drained' })
          input = drained
          continue
        }

        if (pendingNextInput.length > 0) {
          input = pendingNextInput.splice(0)
          continue
        }

        break
      }

      emit(turn.id, { turnId: turn.id, type: 'turn.done' })
    }
    catch (error) {
      if (controller.signal.aborted)
        emit(turn.id, { reason: controller.signal.reason, turnId: turn.id, type: 'turn.aborted' })
      else
        emit(turn.id, { error, turnId: turn.id, type: 'turn.failed' })
    }
    finally {
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

  return {
    abort: reason => activeTurn?.controller.abort(reason),

    clear: () => {
      activeTurn?.controller.abort('cleared')
      pendingInput.length = 0
      pendingNextInput.length = 0
    },

    interrupt: (reason) => {
      const id = activeTurn?.id
      activeTurn?.controller.abort(reason)
      return id
    },

    remove: async () => {
      activeTurn?.controller.abort('removed')
      pendingInput.length = 0
      pendingNextInput.length = 0
      await pumpReady
    },

    send: (item, opts) => {
      const active = activeTurn?.controller.signal.aborted !== true ? activeTurn : undefined

      if (active) {
        if (opts?.mode === 'later') {
          pendingNextInput.push(item)
          return active.id
        }
        pendingInput.push(item)
        emit(active.id, { turnId: active.id, type: 'turn.input_queued' })
        return active.id
      }

      const id = crypto.randomUUID()
      pendingTurns.enqueue({ id, input: [item], signal: opts?.signal })
      emit(id, { turnId: id, type: 'turn.queued' })
      void pump()
      return id
    },
  }
}
