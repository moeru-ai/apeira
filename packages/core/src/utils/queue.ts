import type { MaybePromise } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { AgentInput } from '../types/input'
import type { RunnerContext, RunnerResult } from '../types/runner'
import type { AgentChannel } from './channel'

import Queue from 'yocto-queue'

export interface AgentQueue {
  abort: (reason?: unknown) => void
  clear: () => Promise<void>
  getActiveTurnId: () => string | undefined
  interrupt: (reason?: unknown) => MaybePromise<string | undefined>
  isIdle: () => boolean
  send: (item: AgentInput, options?: AgentSignalOptions) => string
  wait: (options?: AgentSignalOptions) => Promise<void>
}

export interface AgentQueueTurn {
  id: string
  input: AgentInput[]
  signal?: AbortSignal
}

export interface AgentSignalOptions {
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

  const waiters: Array<() => void> = []

  const isIdle: AgentQueue['isIdle'] = () =>
    activeTurn === undefined && pendingInput.length === 0 && pendingTurns.size === 0 && !pumping

  const notifyWaiters = () => {
    if (!isIdle())
      return
    for (const resolve of waiters.splice(0))
      resolve()
  }

  const wait: AgentQueue['wait'] = async (options) => {
    const { signal } = options ?? {}

    if (signal?.aborted)
      throw new DOMException('The operation was aborted.', 'AbortError')

    if (isIdle())
      return

    return new Promise<void>((resolve, reject) => {
      let settled = false
      let onAbort: () => void

      const resolver = () => {
        if (settled)
          return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        resolve()
      }

      onAbort = () => {
        const index = waiters.indexOf(resolver)
        if (index > -1)
          waiters.splice(index, 1)
        if (settled)
          return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        reject(new DOMException('The operation was aborted.', 'AbortError'))
      }

      waiters.push(resolver)
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  const emit = async (turnId: string, event: AgentEvent) =>
    channel.emit('apeira', { ...event, turnId }, { save: true })

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
        await emit(turn.id, { reason: controller.signal.reason, turnId: turn.id, type: 'turn.aborted' })
        return
      }

      await init?.()
      await emit(turn.id, { turnId: turn.id, type: 'turn.start' })

      while (!controller.signal.aborted) {
        await runner({ abortSignal: controller.signal, channel, input, turnId: turn.id })

        if (pendingInput.length > 0) {
          const drained = pendingInput.splice(0)
          await emit(turn.id, { count: drained.length, turnId: turn.id, type: 'turn.input_drained' })
          input = drained
          continue
        }

        break
      }

      if (activeTurn?.id === turn.id)
        activeTurn = undefined

      if (controller.signal.aborted)
        await emit(turn.id, { reason: controller.signal.reason, turnId: turn.id, type: 'turn.aborted' })
      else
        await emit(turn.id, { turnId: turn.id, type: 'turn.done' })
    }
    catch (error) {
      if (activeTurn?.id === turn.id)
        activeTurn = undefined

      if (controller.signal.aborted)
        await emit(turn.id, { reason: controller.signal.reason, turnId: turn.id, type: 'turn.aborted' })
      else
        await emit(turn.id, { error, turnId: turn.id, type: 'turn.failed' })
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
        notifyWaiters()
      }
    })()

    return pumpReady
  }

  const getActiveTurnId: AgentQueue['getActiveTurnId'] = () => activeTurn?.id

  const abort: AgentQueue['abort'] = reason => activeTurn?.controller.abort(reason)

  const clear: AgentQueue['clear'] = async () => {
    activeTurn?.controller.abort('reset')
    pendingInput.length = 0
    pendingTurns.clear()
    notifyWaiters()
  }

  const interrupt: AgentQueue['interrupt'] = (reason) => {
    const active = activeTurn?.controller.signal.aborted === false ? activeTurn : undefined
    active?.controller.abort(reason)
    return active?.id
  }

  const send: AgentQueue['send'] = (item, options) => {
    const active = activeTurn?.controller.signal.aborted !== true ? activeTurn : undefined

    if (active) {
      pendingInput.push(item)
      void emit(active.id, { turnId: active.id, type: 'turn.input_queued' })
      return active.id
    }

    const id = crypto.randomUUID()
    pendingTurns.enqueue({ id, input: [item], signal: options?.signal })
    void emit(id, { turnId: id, type: 'turn.queued' })
    void pump()
    return id
  }

  return {
    abort,
    clear,
    getActiveTurnId,
    interrupt,
    isIdle,
    send,
    wait,
  }
}
