import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext, Instructions, ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { AgentPlugin, AgentPluginApi, ChannelApi, PluginChannelListener, SessionInitOptions, SessionState } from '../types/plugin'
import type { SessionPersistence } from './session-persistence'

import { merge } from '@moeru/std/merge'

import { createAgentSessionState } from './session-state'

export interface AgentRunOptions<T> {
  context?: Partial<AgentContext<T>>
  signal?: AbortSignal
}

export interface AgentSession<T> extends ChannelApi {
  abort: (reason?: unknown) => void
  clear: () => void
  fork: (options?: SessionForkOptions<T>) => Promise<AgentSession<T>>
  getContext: () => AgentContext<T>
  readonly id: string
  interrupt: (reason?: unknown) => void
  remove: () => Promise<void>
  run: (input: ItemParam, options?: AgentRunOptions<T>) => ReadableStream<AgentEvent>
  send: (input: ItemParam, options?: AgentRunOptions<T>) => string
  setContext: (context: Partial<AgentContext<T>>) => void
}

export interface CreateAgentSessionOptions<T> {
  agentContext: () => AgentContext<T>
  agentName: string
  defaultSessionId: string
  emitChannel: AgentPluginApi['emit']
  emitTurn: (sessionId: string, turnId: string, event: Omit<AgentEvent, 'sessionId' | 'turnId'>) => void
  forkSession: (source: SessionForkSource<T>, options?: SessionForkOptions<T>) => Promise<AgentSession<T>>
  id: string
  initial: {
    context?: Partial<AgentContext<T>>
    episodic?: string
    input?: ItemParam[]
  }
  instructions: Instructions<T>
  onRemove: (sessionId: string) => void
  persistence: SessionPersistence<T>
  pluginApi: AgentPluginApi
  plugins: AgentPlugin<T>[]
  ready: Promise<void>
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}

export interface SessionForkOptions<T> {
  context?: Partial<AgentContext<T>>
  id?: string
}

export interface SessionForkSource<T> {
  id: string
  snapshot: () => Promise<SessionState<T>>
}

const createRemovedSessionError = (id: string) =>
  new Error(`Session removed: ${id}`)

export const createAgentSession = <T>(options: CreateAgentSessionOptions<T>): AgentSession<T> => {
  const initialSessionContext = options.initial.context ?? {}

  let currentSessionContext = initialSessionContext
  let removed = false
  let removing = false
  const sessionCleanups = new Set<() => boolean>()
  const wrappedListeners = new WeakMap<PluginChannelListener, PluginChannelListener>()

  const assertSessionOpen = () => {
    if (removed || removing)
      throw createRemovedSessionError(options.id)
  }

  const guard = <Args extends unknown[], Result>(fn: (...args: Args) => Result) =>
    (...args: Args) => {
      assertSessionOpen()
      return fn(...args)
    }

  const guardAsync = <Args extends unknown[], Result>(fn: (...args: Args) => Promise<Result>) =>
    async (...args: Args) => {
      assertSessionOpen()
      return fn(...args)
    }

  const resolveContext = (runContext?: Partial<AgentContext<T>>): AgentContext<T> =>
    merge(merge(options.agentContext(), currentSessionContext), runContext)

  const createSessionOptions = (): SessionInitOptions<T> => ({
    agentName: options.agentName,
    context: resolveContext(),
    sessionId: options.id,
  })

  let sessionReady: Promise<void> | undefined

  const ensureSessionReady = async () => {
    sessionReady ??= options.ready.then(async () => {
      for (const plugin of options.plugins)
        await plugin.onSessionInit?.(createSessionOptions())
    })

    return sessionReady
  }

  const loadSession = async (): Promise<SessionState<T> | undefined> => {
    await ensureSessionReady()

    const state = await options.persistence.load(options.id)

    if (state == null)
      return undefined

    const mergedState = {
      ...state,
      context: merge(initialSessionContext, state.context),
    } satisfies SessionState<T>

    currentSessionContext = mergedState.context
    return mergedState
  }

  const saveSession = async (state: SessionState<T>) => {
    currentSessionContext = state.context
    await options.persistence.save(options.id, state)
  }

  const state = createAgentSessionState({
    agentName: options.agentName,
    emit: (turnId, event) => options.emitTurn(options.id, turnId, event),
    episodic: options.initial.episodic,
    getContext: resolveContext,
    input: options.initial.input,
    instructions: options.instructions,
    loadSession,
    onTurnDone: async (turnContext) => {
      for (const plugin of options.plugins)
        await plugin.onTurnDone?.(turnContext)
    },
    plugins: options.plugins,
    ready: async () => ensureSessionReady(),
    responseOptions: options.responseOptions,
    saveSession,
    sessionContext: initialSessionContext,
    sessionId: options.id,
  })

  const subscribeSession = (channel: string, listener: PluginChannelListener) => {
    const register = () => {
      if (channel === 'apeira') {
        let wrapped = wrappedListeners.get(listener)

        if (!wrapped) {
          wrapped = (event) => {
            const agentEvent = event as AgentEvent

            if (agentEvent.sessionId !== options.id)
              return

            const agentListener = listener as (event: AgentEvent) => void
            agentListener(agentEvent)
          }
          wrappedListeners.set(listener, wrapped)
        }

        return options.pluginApi.subscribe('apeira', wrapped)
      }
      return options.pluginApi.subscribe(channel, listener)
    }

    const unsubscribe = register()
    sessionCleanups.add(unsubscribe)

    return () => {
      sessionCleanups.delete(unsubscribe)
      return unsubscribe()
    }
  }

  const run: AgentSession<T>['run'] = guard((input, runOptions: AgentRunOptions<T> = {}) => {
    const turnId = crypto.randomUUID()
    let unsubscribe: (() => boolean) | undefined

    return new ReadableStream<AgentEvent>({
      cancel: () => {
        unsubscribe?.()
      },
      start: (controller) => {
        unsubscribe = subscribeSession('apeira', (event) => {
          const agentEvent = event as AgentEvent

          if (agentEvent.turnId !== turnId)
            return

          controller.enqueue(agentEvent)

          if (
            agentEvent.type === 'turn.aborted'
            || agentEvent.type === 'turn.done'
            || agentEvent.type === 'turn.failed'
          ) {
            unsubscribe?.()
            controller.close()
          }
        })

        state.enqueueTurn({
          context: runOptions.context,
          id: turnId,
          input,
          signal: runOptions.signal,
        })
      },
    })
  })

  const send: AgentSession<T>['send'] = guard((input, runOptions: AgentRunOptions<T> = {}) =>
    state.send({
      context: runOptions.context,
      input,
      signal: runOptions.signal,
    }))

  const interrupt: AgentSession<T>['interrupt'] = guard((reason) => {
    state.interrupt(reason)
  })

  const setSessionContext: AgentSession<T>['setContext'] = guard((nextContext) => {
    currentSessionContext = merge(currentSessionContext, nextContext)
    state.setContext(nextContext)
  })

  const fork: AgentSession<T>['fork'] = guardAsync(async (forkOptions: SessionForkOptions<T> = {}) =>
    options.forkSession({
      id: options.id,
      snapshot: state.snapshot,
    }, forkOptions))

  const remove: AgentSession<T>['remove'] = async () => {
    assertSessionOpen()

    if (options.id === options.defaultSessionId)
      throw new Error(`Cannot remove default session: ${options.id}`)

    removing = true

    try {
      await state.remove()
      await options.persistence.remove(options.id)

      for (const cleanup of sessionCleanups)
        cleanup()

      options.onRemove(options.id)
      removed = true
    }
    catch (error) {
      removing = false
      throw error
    }
  }

  return {
    abort: guard(state.abort),
    clear: guard(state.clear),
    emit: guard(options.emitChannel),
    fork,
    getContext: guard(() => resolveContext()),
    id: options.id,
    interrupt,
    remove,
    run,
    send,
    setContext: setSessionContext,
    subscribe: guard(subscribeSession) as AgentSession<T>['subscribe'],
  }
}
