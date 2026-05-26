import type { ResponsesOptions } from '@xsai-ext/responses'

import type { Episode, Episodic, NewEpisode } from '../episodic'
import type { AgentContext, Instructions, ItemParam } from '../types/base'
import type { AgentPlugin, SessionState, TurnDoneOptions } from '../types/plugin'
import type { EmitTurnEvent, QueuedInput, TurnCompletion } from './turn-runner'

import Queue from 'yocto-queue'

import { merge } from '@moeru/std/merge'

import { createEpisodic } from '../episodic'
import { linkedAbort } from './linked-abort'
import { createPendingInput } from './pending-input'
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

export interface AgentRuntimeOptions<T> {
  agentName: string
  emit: EmitTurnEvent
  episodic?: string
  getContext: (context?: Partial<AgentContext<T>>) => AgentContext<T>
  input?: ItemParam[]
  instructions: Instructions<T>
  loadSession: () => Promise<SessionState<T> | void> | SessionState<T> | void
  onTurnDone: (options: TurnDoneOptions<T>) => Promise<void> | void
  plugins: AgentPlugin<T>[]
  ready: () => Promise<void>
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  saveSession: (state: SessionState<T>) => Promise<void> | void
  sessionContext?: Partial<AgentContext<T>>
  sessionId: string
}

interface ActiveTurn {
  controller: AbortController
  id: string
}

const TURN_ABORTED_CONTENT = '<turn_aborted>\nThe previous turn was interrupted on purpose. Any tool calls that were running may have partially executed.\n</turn_aborted>'

const cloneContext = <T>(context: Partial<AgentContext<T>>): Partial<AgentContext<T>> =>
  ({ ...context })

const toNewEpisode = (episode: Episode): NewEpisode => {
  switch (episode.type) {
    case 'boundary':
      return { meta: episode.meta, payload: episode.payload, type: 'boundary' }
    case 'item':
      return { meta: episode.meta, payload: episode.payload, type: 'item' }
    case 'meta':
      return { meta: episode.meta, payload: episode.payload, type: 'meta' }
  }
}

export const createAgentRuntime = <T>(options: AgentRuntimeOptions<T>): AgentRuntime<T> => {
  const pendingInput = createPendingInput<T>()
  const pendingTurns = new Queue<QueuedInput<T>>()
  const initialSessionContext = cloneContext<T>(options.sessionContext ?? {})

  let episodic = createEpisodic(options.episodic)
  let sessionContext = cloneContext(initialSessionContext)
  let version = 0

  if (options.episodic == null)
    episodic.appendItems(options.input ?? [], { source: 'user' })

  let acceptingInputTurnId: string | undefined
  let activeTurn: ActiveTurn | undefined
  let loaded = false
  let loadReady: Promise<void> | undefined
  let pendingMutation = Promise.resolve()
  let pumpReady = Promise.resolve()
  let pumping = false

  const abort: AgentRuntime<T>['abort'] = reason =>
    activeTurn?.controller.abort(reason)

  const hydrateSession = (state: SessionState<T>) => {
    episodic = createEpisodic(state.episodic)
    sessionContext = cloneContext(state.context)
    version = state.version
  }

  const snapshotSession = (): SessionState<T> => ({
    context: cloneContext(sessionContext),
    episodic: episodic.toJSONL(),
    version,
  })

  const resetSession = () => {
    episodic = createEpisodic(options.episodic)
    if (options.episodic == null)
      episodic.appendItems(options.input ?? [], { source: 'user' })
    sessionContext = cloneContext(initialSessionContext)
    version += 1
  }

  const mergeWorkingEpisodic = (workingEpisodic: Episodic, fromId: number) => {
    const nextEpisodes = workingEpisodic.read({ fromId })

    for (const episode of nextEpisodes)
      episodic.append(toNewEpisode(episode))

    if (nextEpisodes.length > 0)
      version += 1
  }

  const forkEpisodic = () => {
    const fromId = episodic.read({ limit: 1 })[0]?.id ?? 0
    return [fromId, createEpisodic(episodic.toJSONL())] as const
  }

  const ensureLoaded = async () => {
    await options.ready()

    if (loaded)
      return

    loadReady ??= (async () => {
      try {
        const snapshot = await options.loadSession()

        if (snapshot != null)
          hydrateSession(snapshot)

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

      resetSession()
      await options.saveSession(snapshotSession())
    }).catch(() => undefined)
  }

  const setContext: AgentRuntime<T>['setContext'] = (context) => {
    void mutateSession(async () => {
      await ensureLoaded()
      sessionContext = merge(sessionContext, context)
      await options.saveSession(snapshotSession())
    }).catch(() => undefined)
  }

  const snapshot: AgentRuntime<T>['snapshot'] = async () => {
    await pendingMutation
    await ensureLoaded()
    return snapshotSession()
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
    const [formId, workingEpisodic] = forkEpisodic()
    const completion = await runTurn<T>({
      agentName: options.agentName,
      controller,
      drainInput: () => pendingInput.drain(turn.id!),
      emit: options.emit,
      episodic: workingEpisodic,
      getContext: options.getContext,
      instructions: options.instructions,
      plugins: options.plugins,
      ready: options.ready,
      responseOptions: options.responseOptions,
      sessionId: options.sessionId,
      turn: turn as QueuedInput<T> & { id: string },
    })

    if (completion.type !== 'done')
      return completion

    if (controller.signal.aborted)
      return { reason: controller.signal.reason, type: 'aborted' }

    await mutateSession(async () => {
      if (controller.signal.aborted)
        return

      mergeWorkingEpisodic(workingEpisodic, formId)

      await options.saveSession(snapshotSession())
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
          snapshot: snapshotSession(),
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
      do {
        const turn = pendingTurns.dequeue()
        if (turn == null)
          break

        await runQueuedTurn(turn)
      } while (pendingTurns.size > 0)
    })().finally(() => {
      pumping = false
    })

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
        episodic.append({
          meta: { source: 'runtime', turnId: turn.id },
          payload: {
            content: TURN_ABORTED_CONTENT,
            reason: 'interrupt',
            title: 'turn interrupted',
          },
          type: 'boundary',
        })
        await options.saveSession(snapshotSession())
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
