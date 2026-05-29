import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext, Instructions, ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { AgentPlugin, AgentPluginApi, AgentPluginOption, ChannelApi, PluginChannelListener } from '../types/plugin'
import type { AgentRunOptions, AgentSession, SessionForkOptions, SessionForkSource } from './agent-session'

import { merge } from '@moeru/std/merge'

import { createAgentSession } from './agent-session'
import { createSessionPersistence } from './session-persistence'

export interface Agent<T> extends ChannelApi {
  abort: (reason?: unknown) => void
  clear: () => void
  getContext: () => AgentContext<T>
  interrupt: (reason?: unknown) => void
  run: (input: ItemParam, options?: AgentRunOptions<T>) => ReadableStream<AgentEvent>
  send: (input: ItemParam, options?: AgentRunOptions<T>) => string
  session: (options?: SessionOptions<T>) => AgentSession<T>
  setContext: (context: Partial<AgentContext<T>>) => void
}

export interface CreateAgentOptions<T = unknown> {
  context?: AgentContext<T>
  input?: ItemParam[]
  instructions: Instructions<T>
  name: string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  plugins?: AgentPluginOption<T>[]
}

export interface SessionOptions<T> {
  context?: Partial<AgentContext<T>>
  episodic?: string
  id?: string
  input?: ItemParam[]
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
    pluginApi.emit('apeira', fullEvent)
    void ready.then(async () => {
      for (const plugin of plugins) {
        try {
          await plugin.onEvent?.(fullEvent)
        }
        catch {}
      }
    }).catch(() => undefined)
  }

  const getContext: Agent<T>['getContext'] = () => context

  const setContext: Agent<T>['setContext'] = nextContext =>
    context = merge(context, nextContext)

  const emitChannel: Agent<T>['emit'] = (channel, event) =>
    pluginApi.emit(channel, event)

  const subscribe = (channel: string, listener: PluginChannelListener) =>
    pluginApi.subscribe(channel, listener)

  const persistence = createSessionPersistence(options.name, plugins)

  const sessions = new Map<string, AgentSession<T>>()

  const forkSession = async (
    source: SessionForkSource<T>,
    forkOptions: SessionForkOptions<T> = {},
  ): Promise<AgentSession<T>> => {
    const forkId = forkOptions.id ?? crypto.randomUUID()

    if (sessions.has(forkId))
      throw new Error(`Session already exists: ${forkId}`)

    const snapshot = await source.snapshot()
    const forkContext = merge(snapshot.context, forkOptions.context ?? {})

    if (sessions.has(forkId))
      throw new Error(`Session already exists: ${forkId}`)

    const forked = createAgentSession({
      agentContext: () => context,
      agentName: options.name,
      defaultSessionId: options.name,
      emitChannel,
      emitTurn: emit,
      forkSession,
      id: forkId,
      initial: { context: forkContext, episodic: snapshot.episodic },
      instructions: options.instructions,
      onRemove: (sessionId: string) => sessions.delete(sessionId),
      persistence,
      pluginApi,
      plugins,
      ready,
      responseOptions: options.options,
    })

    sessions.set(forkId, forked)

    try {
      await persistence.save(forkId, {
        context: forkContext,
        episodic: snapshot.episodic,
      })
    }
    catch (error) {
      sessions.delete(forkId)
      throw error
    }

    return forked
  }

  const session: Agent<T>['session'] = (sessionOptions = {}) => {
    const id = sessionOptions.id ?? crypto.randomUUID()
    const existing = sessions.get(id)

    if (existing != null) {
      if (sessionOptions.input != null || sessionOptions.episodic != null)
        throw new Error(`Session already exists: ${id}`)

      if (sessionOptions.context != null)
        existing.setContext(sessionOptions.context)

      return existing
    }

    const agentSession = createAgentSession({
      agentContext: () => context,
      agentName: options.name,
      defaultSessionId: options.name,
      emitChannel,
      emitTurn: emit,
      forkSession,
      id,
      initial: {
        context: sessionOptions.context,
        episodic: sessionOptions.episodic,
        input: sessionOptions.input,
      },
      instructions: options.instructions,
      onRemove: (sessionId: string) => sessions.delete(sessionId),
      persistence,
      pluginApi,
      plugins,
      ready,
      responseOptions: options.options,
    })

    sessions.set(id, agentSession)

    return agentSession
  }

  const defaultSession = session({
    id: options.name,
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
