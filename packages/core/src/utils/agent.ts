import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext, Instructions } from '../types/context'
import type { AgentEvent } from '../types/event'
import type { AgentPlugin, AgentPluginApi, AgentPluginOption, PluginChannelListener, SessionInitOptions, SessionState } from '../types/plugin'
import type { ItemParam } from '../types/responses'
import type { AgentSession, SessionForkOptions } from './agent-session'

import { merge } from '@moeru/std/merge'

import { createAgentRuntime } from './agent-runtime'

export interface Agent<T> extends Omit<AgentSession<T>, 'fork' | 'id' | 'remove'> {
  session: (options?: SessionOptions<T>) => AgentSession<T>
}

export type CreateAgentOptions<T = unknown> = CreateAgentBaseOptions<T> & CreateAgentContextOptions<T>

export interface SessionOptions<T> {
  context?: Partial<AgentContext<T>>
  id?: string
  input?: ItemParam[]
}

interface CreateAgentBaseOptions<T> {
  input?: ItemParam[]
  instructions: Instructions<T>
  name: string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  plugins?: AgentPluginOption<T>[]
}

type CreateAgentContextOptions<T> = [RequiredKeys<T>] extends [never]
  ? { context?: AgentContext<T> }
  : { context: AgentContext<T> }

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K
}[keyof T]

const DEFAULT_SESSION_ID = 'default'

const getSessionStorageKey = (agentName: string, sessionId: string) =>
  JSON.stringify([agentName, sessionId])

const parseSessionState = <T>(value: null | string | undefined): SessionState<T> | undefined => {
  if (value == null)
    return undefined

  try {
    return JSON.parse(value) as SessionState<T>
  }
  catch {
    return undefined
  }
}

const normalizePlugins = <T>(plugins: AgentPluginOption<T>[]): AgentPlugin<T>[] =>
  plugins.flatMap((plugin) => {
    if (plugin == null || plugin === false)
      return []

    if (Array.isArray(plugin))
      return normalizePlugins(plugin)

    return [plugin]
  })

const sortPlugins = <T>(plugins: AgentPluginOption<T>[]) => {
  const order = { post: 2, pre: 0 } as const
  return normalizePlugins(plugins).sort(
    (a, b) => (order[a.enforce as keyof typeof order] ?? 1) - (order[b.enforce as keyof typeof order] ?? 1),
  )
}

export const createAgent = <T = unknown>(options: CreateAgentOptions<T>): Agent<T> => {
  const plugins = sortPlugins(options.plugins ?? [])
  const channelListeners = new Map<string, Set<PluginChannelListener>>()
  const sessions = new Map<string, AgentSession<T>>()

  let context: AgentContext<T> = options.context ?? {} as AgentContext<T>

  const pluginApi: AgentPluginApi = {
    emit: (channel: string, event: unknown) => {
      for (const listener of [...(channelListeners.get(channel) ?? [])]) {
        try {
          listener(event)
        }
        catch {}
      }
    },
    subscribe: ((channel: string, listener: PluginChannelListener) => {
      const listeners = channelListeners.get(channel) ?? new Set<PluginChannelListener>()
      listeners.add(listener)
      channelListeners.set(channel, listeners)

      return () => listeners.delete(listener)
    }) as AgentPluginApi['subscribe'],
  }

  const ready = (async () => {
    for (const plugin of plugins)
      await plugin.setup?.(pluginApi)
  })()
  void ready.catch(() => undefined)

  const emit = (
    sessionId: string,
    turnId: string,
    event: Omit<AgentEvent, 'sessionId' | 'turnId'>,
  ) => {
    const fullEvent = { ...event, sessionId, turnId } as AgentEvent

    for (const listener of [...(channelListeners.get('apeira') ?? [])]) {
      try {
        listener(fullEvent)
      }
      catch {}
    }

    void ready.then(async () => {
      for (const plugin of plugins)
        await plugin.onEvent?.(fullEvent)
    }).catch(() => undefined)
  }

  const getContext: Agent<T>['getContext'] = () => context

  const setContext: Agent<T>['setContext'] = nextContext =>
    context = merge(context, nextContext)

  const emitChannel: Agent<T>['emit'] = (channel, event) =>
    pluginApi.emit(channel, event)

  const subscribe = (channel: string, listener: PluginChannelListener) =>
    pluginApi.subscribe(channel, listener)

  const withSessionStorage = async (
    sessionId: string,
    fn: (storage: NonNullable<AgentPlugin<T>['storage']>, key: string) => Promise<void> | void,
  ) => {
    const key = getSessionStorageKey(options.name, sessionId)

    for (const plugin of plugins) {
      if (plugin.storage == null)
        continue

      await fn(plugin.storage, key)
    }
  }

  const saveSessionState = async (sessionId: string, state: SessionState<T>) => {
    await withSessionStorage(sessionId, async (storage, key) => storage.setItem(key, JSON.stringify(state)))
  }

  const removeSessionState = async (sessionId: string) => {
    await withSessionStorage(sessionId, async (storage, key) => storage.removeItem(key))
  }

  const createAgentSession = (id: string, sessionOptions: SessionOptions<T> = {}): AgentSession<T> => {
    const initialSessionContext = sessionOptions.context ?? {}

    let currentSessionContext = initialSessionContext
    let removed = false
    let removing = false

    const createRemovedSessionError = () =>
      new Error(`Session removed: ${id}`)

    const assertSessionOpen = () => {
      if (removed || removing)
        throw createRemovedSessionError()
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
      merge(merge(context, currentSessionContext), runContext)

    const createSessionOptions = (): SessionInitOptions<T> => ({
      agentName: options.name,
      context: resolveContext(),
      sessionId: id,
    })

    let sessionReady: Promise<void> | undefined

    const ensureSessionReady = async () => {
      sessionReady ??= ready.then(async () => {
        for (const plugin of plugins)
          await plugin.onSessionInit?.(createSessionOptions())
      })

      return sessionReady
    }

    const loadSession = async (): Promise<SessionState<T> | undefined> => {
      await ensureSessionReady()

      for (const plugin of plugins) {
        if (plugin.storage == null)
          continue

        const value = await plugin.storage.getItem(getSessionStorageKey(options.name, id))
        const state = parseSessionState<T>(value)

        if (state != null) {
          const mergedState = {
            ...state,
            context: merge(initialSessionContext, state.context),
          } satisfies SessionState<T>

          currentSessionContext = mergedState.context
          return mergedState
        }
      }
    }

    const saveSession = async (state: SessionState<T>) => {
      currentSessionContext = state.context
      await saveSessionState(id, state)
    }

    const runtime = createAgentRuntime({
      agentName: options.name,
      emit: (turnId, event) => emit(id, turnId, event),
      getContext: resolveContext,
      input: sessionOptions.input,
      instructions: options.instructions,
      loadSession,
      onTurnDone: async (turnContext) => {
        for (const plugin of plugins)
          await plugin.onTurnDone?.(turnContext)
      },
      plugins,
      ready: async () => ensureSessionReady(),
      responseOptions: options.options,
      saveSession,
      sessionContext: initialSessionContext,
      sessionId: id,
    })

    const subscribeSession = (channel: string, listener: PluginChannelListener) => {
      if (channel === 'apeira') {
        const agentListener = listener as (event: AgentEvent) => void
        const wrapped: PluginChannelListener = (event) => {
          const agentEvent = event as AgentEvent

          if (agentEvent.sessionId !== id)
            return

          agentListener(agentEvent)
        }
        return pluginApi.subscribe('apeira', wrapped)
      }
      return pluginApi.subscribe(channel, listener)
    }

    const run: AgentSession<T>['run'] = guard((input, runOptions = {}) => {
      const turnId = crypto.randomUUID()
      let unsubscribe: (() => boolean) | undefined

      return new ReadableStream<AgentEvent>({
        cancel: () => {
          unsubscribe?.()
        },
        start: (controller) => {
          unsubscribe = pluginApi.subscribe('apeira', (event: unknown) => {
            const agentEvent = event as AgentEvent

            if (agentEvent.sessionId !== id || agentEvent.turnId !== turnId)
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

          runtime.enqueueTurn({
            context: runOptions.context,
            id: turnId,
            input,
            signal: runOptions.signal,
          })
        },
      })
    })

    const send: AgentSession<T>['send'] = guard((input, runOptions = {}) =>
      runtime.send({
        context: runOptions.context,
        input,
        signal: runOptions.signal,
      }))

    const interrupt: AgentSession<T>['interrupt'] = guard((reason) => {
      runtime.interrupt(reason)
    })

    const setSessionContext: AgentSession<T>['setContext'] = guard((nextContext) => {
      currentSessionContext = merge(currentSessionContext, nextContext)
      runtime.setContext(nextContext)
    })

    const fork: AgentSession<T>['fork'] = guardAsync(async (forkOptions: SessionForkOptions<T> = {}) => {
      const forkId = forkOptions.id ?? crypto.randomUUID()

      if (sessions.has(forkId))
        throw new Error(`Session already exists: ${forkId}`)

      const snapshot = await runtime.snapshot()
      const forkContext = merge(snapshot.context, forkOptions.context ?? {})

      if (sessions.has(forkId))
        throw new Error(`Session already exists: ${forkId}`)

      const forked = createAgentSession(forkId, {
        context: forkContext,
        id: forkId,
        input: snapshot.items,
      })

      sessions.set(forkId, forked)

      await saveSessionState(forkId, {
        context: forkContext,
        items: snapshot.items,
        version: 0,
      })

      return forked
    })

    const remove: AgentSession<T>['remove'] = async () => {
      assertSessionOpen()

      if (id === DEFAULT_SESSION_ID)
        throw new Error(`Cannot remove default session: ${id}`)

      removing = true

      try {
        await runtime.remove()
        await removeSessionState(id)

        sessions.delete(id)
        removed = true
      }
      catch (error) {
        removing = false
        throw error
      }
    }

    return {
      abort: guard(runtime.abort),
      clear: guard(runtime.clear),
      emit: guard(emitChannel),
      fork,
      getContext: guard(() => resolveContext()),
      id,
      interrupt,
      remove,
      run,
      send,
      setContext: setSessionContext,
      subscribe: guard(subscribeSession) as AgentSession<T>['subscribe'],
    }
  }

  const session: Agent<T>['session'] = (sessionOptions = {}) => {
    const id = sessionOptions.id ?? crypto.randomUUID()
    const existing = sessions.get(id)
    if (existing != null) {
      if (sessionOptions.input != null)
        throw new Error(`Session already exists: ${id}`)

      if (sessionOptions.context != null)
        existing.setContext(sessionOptions.context)

      return existing
    }

    const agentSession = createAgentSession(id, sessionOptions)

    sessions.set(id, agentSession)

    return agentSession
  }

  const defaultSession = session({
    id: DEFAULT_SESSION_ID,
    input: options.input,
  })

  return {
    abort: reason => defaultSession.abort(reason),
    clear: () => defaultSession.clear(),
    emit: emitChannel,
    getContext,
    interrupt: reason => defaultSession.interrupt(reason),
    run: (input, runOptions) => defaultSession.run(input, runOptions),
    send: (input, runOptions) => defaultSession.send(input, runOptions),
    session,
    setContext,
    subscribe: subscribe as Agent<T>['subscribe'],
  }
}
