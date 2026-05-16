import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { TurnDoneContext } from '../types/plugin'
import type { ItemParam } from '../types/responses'
import type { ThreadSnapshot } from './thread-store'
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
  agentName: string
  emit: EmitTurnEvent
  getContext: (context?: Partial<AgentContext<T>>) => AgentContext<T>
  input?: ItemParam[]
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  loadThread: () => Promise<ThreadSnapshot | void> | ThreadSnapshot | void
  onTurnDone: (context: TurnDoneContext<T>) => Promise<void> | void
  plugins: TurnOptions<T>['plugins']
  ready: () => Promise<void>
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  saveThread: TurnOptions<T>['saveThread']
  threadId: string
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

  let acceptingInputTurnId: string | undefined
  let activeTurn: ActiveTurn | undefined
  let loaded = false
  let loadReady: Promise<void> | undefined
  let pendingMutation = Promise.resolve()
  let pumping = false

  const abort: AgentRuntime<T>['abort'] = reason =>
    activeTurn?.controller.abort(reason)

  const ensureLoaded = async () => {
    await options.ready()

    if (loaded)
      return

    loadReady ??= (async () => {
      try {
        const snapshot = await options.loadThread()

        if (snapshot != null)
          thread.hydrate(snapshot)

        loaded = true
      }
      catch (error) {
        loadReady = undefined
        throw error
      }
    })()

    await loadReady
  }

  const mutateThread = async (fn: () => Promise<void>) => {
    const next = pendingMutation.then(fn, fn)
    pendingMutation = next.catch(() => undefined)

    return next
  }

  const turnOptions: TurnOptions<T> = {
    agentName: options.agentName,
    emit: options.emit,
    getContext: options.getContext,
    instructions: options.instructions,
    mutateThread,
    plugins: options.plugins,
    ready: options.ready,
    responseOptions: options.responseOptions,
    saveThread: options.saveThread,
    thread,
    threadId: options.threadId,
  }

  const clear: AgentRuntime<T>['clear'] = () => {
    acceptingInputTurnId = undefined
    abort('cleared')

    pendingInput.clear()

    for (const turn of pendingTurns.drain())
      options.emit(turn.id, { reason: 'cleared', type: 'turn.aborted' })

    void mutateThread(async () => {
      await ensureLoaded()

      thread.reset()
      await options.saveThread({
        agentName: options.agentName,
        context: options.getContext(),
        reason: 'clear',
        snapshot: thread.snapshot(),
        threadId: options.threadId,
      })
    }).catch(() => undefined)
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
    while (pendingTurns.size > 0) {
      const turn = pendingTurns.peek()

      if (turn?.signal?.aborted !== true)
        return turn?.id

      pendingTurns.dequeue()
      abortQueuedTurn(turn)
    }

    return undefined
  }

  const runQueuedTurn = async (turn: QueuedTurn<T>) => {
    if (turn.signal?.aborted === true) {
      abortQueuedTurn(turn)
      return
    }

    try {
      await pendingMutation
      await ensureLoaded()
    }
    catch (error) {
      completeTurn(turn.id, { error, type: 'failed' })
      return
    }

    const controller = linkedAbort(turn.signal)
    let completion: TurnCompletion<T> = {
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
      completion = await runTurn<T>({
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

    if (completion.type === 'done') {
      try {
        await options.onTurnDone({
          ...completion.context,
          snapshot: thread.snapshot(),
        })
      }
      catch (error) {
        completion = { error, type: 'failed' }
      }
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
