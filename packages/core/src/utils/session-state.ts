import type { ResponsesOptions } from '@xsai-ext/responses'

import type { Episode, Episodic, NewEpisode } from '../episodic'
import type { AgentContext, Instructions, ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { AgentPlugin, SessionState, TurnDoneOptions } from '../types/plugin'
import type { EmitTurnEvent, QueuedInput, TurnCompletion } from './turn-runner'

import { merge } from '@moeru/std/merge'

import { createEpisodic } from '../episodic'
import { createTurnOrchestrator } from './turn-orchestrator'
import { runTurn } from './turn-runner'

export interface AgentSessionStateOptions<T> {
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

const TURN_ABORTED_CONTENT = '<turn_aborted>\nThe previous turn was interrupted on purpose. Any tool calls that were running may have partially executed.\n</turn_aborted>'

const toNewEpisode = ({ id: _, ...rest }: Episode): NewEpisode =>
  rest

export const createAgentSessionState = <T>(options: AgentSessionStateOptions<T>) => {
  let episodic = createEpisodic(options.episodic)
  let sessionContext = { ...(options.sessionContext ?? {}) } as Partial<AgentContext<T>>
  const initialSessionContext = { ...sessionContext }
  let loaded = false
  let loadReady: Promise<void> | undefined
  let pendingMutation = Promise.resolve()

  if (options.episodic == null)
    episodic.appendItems(options.input ?? [], { source: 'user' })

  const ensureLoaded = async () => {
    await options.ready()
    if (loaded) return

    loadReady ??= (async () => {
      try {
        const snapshot = await options.loadSession()
        if (snapshot != null) {
          episodic = createEpisodic(snapshot.episodic)
          sessionContext = { ...snapshot.context }
        }
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

  const snapshotSession = (): SessionState<T> => ({
    context: { ...sessionContext },
    episodic: episodic.toJSONL(),
  })

  const resetSession = () => {
    episodic = createEpisodic(options.episodic)
    if (options.episodic == null)
      episodic.appendItems(options.input ?? [], { source: 'user' })
    sessionContext = { ...initialSessionContext }
  }

  const executeTurn = async (
    turn: QueuedInput<T> & { id: string },
    controller: AbortController,
    drainInput: () => QueuedInput<T>[],
  ): Promise<TurnCompletion<T>> => {
    await pendingMutation
    await ensureLoaded()
    if (controller.signal.aborted)
      return { reason: controller.signal.reason, type: 'aborted' }

    const fromId = episodic.read({ limit: 1 })[0]?.id ?? 0
    const workingEpisodic = createEpisodic(episodic.read({ fromId: 0 }))
    const completion = await runTurn({ ...options, controller, drainInput, episodic: workingEpisodic, turn })

    if (completion.type !== 'done' || controller.signal.aborted)
      return completion.type !== 'done' ? completion : { reason: controller.signal.reason, type: 'aborted' }

    await mutateSession(async () => {
      if (controller.signal.aborted) return
      for (const episode of workingEpisodic.read({ fromId }))
        episodic.append(toNewEpisode(episode))
      await options.saveSession(snapshotSession())
    })

    return controller.signal.aborted
      ? { reason: controller.signal.reason, type: 'aborted' }
      : completion
  }

  const orchestrator = createTurnOrchestrator<T>({
    emit: options.emit,
    executeTurn,
    onTurnDone: async (completion) => {
      if (completion.type === 'done') {
        await options.onTurnDone({
          ...completion.context,
          snapshot: snapshotSession(),
        })
      }
    },
  })

  const setContext = (context: Partial<AgentContext<T>>) => {
    void mutateSession(async () => {
      await ensureLoaded()
      sessionContext = merge(sessionContext, context)
      await options.saveSession(snapshotSession())
    }).catch(() => undefined)
  }

  const interrupt = (reason: unknown = 'interrupted') => {
    const turnId = orchestrator.interrupt(reason)
    if (turnId == null) return
    void mutateSession(async () => {
      await ensureLoaded()
      episodic.append({
        meta: { source: 'runtime', turnId },
        payload: { content: TURN_ABORTED_CONTENT, reason: 'interrupt', title: 'turn interrupted' },
        type: 'boundary',
      })
      await options.saveSession(snapshotSession())
    }).catch(() => undefined)
  }

  const clear = () => {
    orchestrator.clear()
    void mutateSession(async () => {
      await ensureLoaded()
      resetSession()
      await options.saveSession(snapshotSession())
    }).catch(() => undefined)
  }

  const snapshot = async () => {
    await pendingMutation
    await ensureLoaded()
    return snapshotSession()
  }

  const remove = async (reason: unknown = 'removed') => {
    await orchestrator.remove()
    await pendingMutation
  }

  return {
    abort: orchestrator.abort,
    clear,
    enqueueTurn: orchestrator.enqueueTurn,
    interrupt,
    remove,
    send: orchestrator.send,
    setContext,
    snapshot,
  }
}
