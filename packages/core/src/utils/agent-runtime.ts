import type { AgentContext } from '../types/context'
import type { SessionState, TurnDoneOptions } from '../types/plugin'
import type { ItemParam } from '../types/responses'
import type { AgentCoreOptions, QueuedInput, TurnCompletion, TurnOptions } from './turn-runner'

import Queue from 'yocto-queue'

import { linkedAbort } from './linked-abort'
import { createPendingInput } from './pending-input'
import { createSessionStore } from './session-store'
import { runTurn } from './turn-runner'

export interface AgentRuntime<T = unknown> {
  abort: (reason?: unknown) => void
  clear: () => void
  enqueueTurn: (turn: QueuedInput<T>) => void
  interrupt: (reason?: unknown) => void
  remove: (reason?: unknown) => Promise<void>
  send: (input: QueuedInput<T>) => string
  setContext: (context: Partial<AgentContext<T>>) => void
  snapshot: () => Promise<SessionState<T>>
}

export interface AgentRuntimeOptions<T> extends AgentCoreOptions<T> {
  episodic?: string
  input?: ItemParam[]
  loadSession: () => Promise<SessionState<T> | void> | SessionState<T> | void
  onTurnDone: (options: TurnDoneOptions<T>) => Promise<void> | void
  saveSession: (state: SessionState<T>) => Promise<void> | void
  sessionContext?: Partial<AgentContext<T>>
}

interface ActiveTurn {
  controller: AbortController
  id: string
  input: ItemParam
}

const TURN_ABORTED_CONTENT = '<turn_aborted>\nThe previous turn was interrupted on purpose. Any tool calls that were running may have partially executed.\n</turn_aborted>'

export const createAgentRuntime = <T>(options: AgentRuntimeOptions<T>): AgentRuntime<T> => {
  const pendingInput = createPendingInput<T>()
  const pendingTurns = new Queue<QueuedInput<T>>()
  const session = createSessionStore<T>(options.input, options.sessionContext, options.episodic)

  let acceptingInputTurnId: string | undefined
  let activeTurn: ActiveTurn | undefined
  let loaded = false
  let loadReady: Promise<void> | undefined
  let pendingMutation = Promise.resolve()
  let pumpReady = Promise.resolve()
  let pumping = false

  const abort: AgentRuntime<T>['abort'] = reason =>
    activeTurn?.controller.abort(reason)

  const ensureLoaded = async () => {
    await options.ready()

    if (loaded)
      return

    loadReady ??= (async () => {
      try {
        const snapshot = await options.loadSession()

        if (snapshot != null)
          session.hydrate(snapshot)

        loaded = true
      }
      catch (error) {
        loadReady = undefined
        throw error
      }
    })()

    await loadReady
  }

  const mutateSession = async (fn: () => Promise<void>) => {
    const next = pendingMutation.then(fn, fn)
    pendingMutation = next.catch(() => undefined)

    return next
  }

  const turnOptions: TurnOptions<T> = {
    agentName: options.agentName,
    emit: options.emit,
    getContext: options.getContext,
    instructions: options.instructions,
    plugins: options.plugins,
    ready: options.ready,
    responseOptions: options.responseOptions,
    session,
    sessionId: options.sessionId,
  }

  const completeTurn = (id: string, completion: TurnCompletion) => {
    pendingInput.delete(id)

    if (completion.type === 'done')
      return options.emit(id, { type: 'turn.done' })

    if (completion.type === 'aborted')
      return options.emit(id, { reason: completion.reason, type: 'turn.aborted' })

    return options.emit(id, { error: completion.error, type: 'turn.failed' })
  }

  const abortQueuedTurn = (turn: QueuedInput<T>) =>
    completeTurn(turn.id!, {
      reason: turn.signal?.reason,
      type: 'aborted',
    })

  const abortQueuedTurns = (reason: unknown) => {
    for (const turn of pendingTurns.drain())
      completeTurn(turn.id!, { reason, type: 'aborted' })
  }

  const stopSession = (reason: unknown) => {
    acceptingInputTurnId = undefined
    abort(reason)
    pendingInput.clear()
    abortQueuedTurns(reason)
  }

  const clear: AgentRuntime<T>['clear'] = () => {
    stopSession('cleared')

    void mutateSession(async () => {
      await ensureLoaded()

      session.reset()
      await options.saveSession(session.snapshot())
    }).catch(() => undefined)
  }

  const setContext: AgentRuntime<T>['setContext'] = (context) => {
    void mutateSession(async () => {
      await ensureLoaded()
      session.setContext(context)
      await options.saveSession(session.snapshot())
    }).catch(() => undefined)
  }

  const snapshot: AgentRuntime<T>['snapshot'] = async () => {
    await pendingMutation
    await ensureLoaded()
    return session.snapshot()
  }

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

  const runWorkingTurn = async (
    controller: AbortController,
    turn: QueuedInput<T>,
  ): Promise<TurnCompletion<T>> => {
    const workingSession = session.fork()
    const completion = await runTurn<T>({
      ...turnOptions,
      controller,
      drainInput: () => pendingInput.drain(turn.id!),
      session: workingSession,
      turn: turn as QueuedInput<T> & { id: string },
    })

    if (completion.type !== 'done')
      return completion

    await mutateSession(async () => {
      session.merge(workingSession)
      await options.saveSession(session.snapshot())
    })

    return controller.signal.aborted
      ? { reason: controller.signal.reason, type: 'aborted' }
      : completion
  }

  const runQueuedTurn = async (turn: QueuedInput<T>) => {
    if (turn.signal?.aborted === true) {
      abortQueuedTurn(turn)
      return
    }

    const controller = linkedAbort(turn.signal)
    let completion: TurnCompletion<T> = {
      error: new Error('Turn did not complete.'),
      type: 'failed',
    }

    activeTurn = {
      controller,
      id: turn.id!,
      input: turn.input,
    }
    acceptingInputTurnId = turn.id

    try {
      await pendingMutation
      await ensureLoaded()

      if (controller.signal.aborted) {
        completion = { reason: controller.signal.reason, type: 'aborted' }
      }
      else {
        completion = await runWorkingTurn(controller, turn)
      }
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
          snapshot: session.snapshot(),
        })
      }
      catch (error) {
        completion = { error, type: 'failed' }
      }
    }

    completeTurn(turn.id!, completion)
  }

  const pumpTurns = async () => {
    if (pumping)
      return pumpReady

    pumping = true

    pumpReady = (async () => {
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
          await pumpTurns()
      }
    })()

    return pumpReady
  }

  const enqueueTurn = (turn: QueuedInput<T>) => {
    options.emit(turn.id!, { type: 'turn.queued' })
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

  const interrupt = (reason: unknown = 'interrupted') => {
    const turn = activeTurn

    if (turn != null && turn.controller.signal.aborted !== true) {
      turn.controller.abort(reason)

      void mutateSession(async () => {
        await ensureLoaded()
        session.episodic.append({
          kind: 'boundary',
          meta: { source: 'runtime', turnId: turn.id },
          payload: {
            content: TURN_ABORTED_CONTENT,
            reason: 'interrupt',
            title: 'turn interrupted',
          },
        })
        await options.saveSession(session.snapshot())
      }).catch(() => undefined)
    }
  }

  const remove: AgentRuntime<T>['remove'] = async (reason: unknown = 'removed') => {
    stopSession(reason)
    await pumpReady
    await pendingMutation
  }

  return {
    abort,
    clear,
    enqueueTurn,
    interrupt,
    remove,
    send,
    setContext,
    snapshot,
  }
}
