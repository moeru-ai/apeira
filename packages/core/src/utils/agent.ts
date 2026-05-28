import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext, Instructions, ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { AgentPlugin, AgentPluginApi, AgentPluginOption, PluginChannelListener } from '../types/plugin'
import type { AgentSession } from './agent-session'

import { merge } from '@moeru/std/merge'

import { DEFAULT_SESSION_ID } from './session-constants'
import { createSessionManager } from './session-manager'
import { createSessionPersistence } from './session-persistence'

export interface Agent<T> extends Omit<AgentSession<T>, 'fork' | 'id' | 'remove'> {
  session: (options?: SessionOptions<T>) => AgentSession<T>
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
  const defaultSessionId = DEFAULT_SESSION_ID
  const sessionManager = createSessionManager<T>({
    agentContext: () => context,
    agentName: options.name,
    defaultSessionId,
    emitChannel,
    emitTurn: emit,
    instructions: options.instructions,
    persistence,
    pluginApi,
    plugins,
    ready,
    responseOptions: options.options,
  })

  const defaultSession = sessionManager.session({
    id: defaultSessionId,
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
    session: sessionManager.session,
    setContext,
    subscribe: subscribe as Agent<T>['subscribe'],
  }
}
