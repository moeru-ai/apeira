import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { AgentEvent } from '../types/event'
import type { AgentEventListener } from '../types/event-listener'
import type { AgentPlugin, AgentPluginApi, AgentPluginOption, PluginChannelListener, ThreadInitOptions } from '../types/plugin'
import type { ItemParam } from '../types/responses'
import type { AgentThread } from './agent-thread'

import { merge } from '@moeru/std/merge'

import { createAgentRuntime } from './agent-runtime'

export interface Agent<T> extends Omit<AgentThread<T>, 'id'> {
  thread: (options?: ThreadOptions<T>) => AgentThread<T>
}

export type CreateAgentOptions<T = unknown> = CreateAgentBaseOptions<T> & CreateAgentContextOptions<T>

export interface ThreadOptions<T> {
  context?: Partial<AgentContext<T>>
  id?: string
  input?: ItemParam[]
}

interface CreateAgentBaseOptions<T> {
  input?: ItemParam[]
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
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

const DEFAULT_THREAD_ID = 'default'

const normalizePlugins = <T>(plugins: AgentPluginOption<T>[]): AgentPlugin<T>[] =>
  plugins.flatMap((plugin) => {
    if (plugin == null || plugin === false)
      return []

    if (Array.isArray(plugin))
      return normalizePlugins(plugin)

    return [plugin]
  })

const sortPlugins = <T>(plugins: AgentPluginOption<T>[]) => {
  const normalized = normalizePlugins(plugins)

  return [
    ...normalized.filter(plugin => plugin.enforce === 'pre'),
    ...normalized.filter(plugin => plugin.enforce == null),
    ...normalized.filter(plugin => plugin.enforce === 'post'),
  ]
}

export const createAgent = <T = unknown>(options: CreateAgentOptions<T>): Agent<T> => {
  const plugins = sortPlugins(options.plugins ?? [])
  const channelListeners = new Map<string, Set<PluginChannelListener<T>>>()
  const eventListeners = new Set<AgentEventListener>()
  const threads = new Map<string, AgentThread<T>>()

  let context: AgentContext<T> = options.context ?? {} as AgentContext<T>

  const pluginApi: AgentPluginApi<T> = {
    emit: (channel, event) => {
      for (const listener of [...(channelListeners.get(channel) ?? [])]) {
        try {
          listener(event, { channel, pluginApi })
        }
        catch {}
      }
    },
    subscribe: (channel, listener) => {
      const listeners = channelListeners.get(channel) ?? new Set<PluginChannelListener<T>>()
      listeners.add(listener)
      channelListeners.set(channel, listeners)

      return () => listeners.delete(listener)
    },
  }

  const ready = (async () => {
    for (const plugin of plugins)
      await plugin.setup?.(pluginApi)
  })()
  void ready.catch(() => undefined)

  const emit = (
    threadId: string,
    turnId: string,
    event: Omit<AgentEvent, 'threadId' | 'turnId'>,
    getContext: () => AgentContext<T>,
  ) => {
    const fullEvent = { ...event, threadId, turnId } as AgentEvent

    for (const fn of [...eventListeners]) {
      try {
        fn(fullEvent)
      }
      catch {}
    }

    void ready.then(async () => {
      for (const plugin of plugins)
        await plugin.onEvent?.(fullEvent, { agentName: options.name, getContext, threadId, turnId })
    }).catch(() => undefined)
  }

  const getContext: Agent<T>['getContext'] = () => context

  const setContext: Agent<T>['setContext'] = nextContext =>
    context = merge(context, nextContext)

  const subscribe: Agent<T>['subscribe'] = (eventListener) => {
    eventListeners.add(eventListener)
    return () => eventListeners.delete(eventListener)
  }

  const createAgentThread = (id: string, threadOptions: ThreadOptions<T> = {}): AgentThread<T> => {
    let threadContext = threadOptions.context ?? {}

    const resolveContext = (runContext?: Partial<AgentContext<T>>): AgentContext<T> =>
      merge(merge(context, threadContext), runContext)

    const createThreadOptions = (): ThreadInitOptions<T> => ({
      agentName: options.name,
      context: resolveContext(),
      threadId: id,
    })

    let threadReady: Promise<void> | undefined

    const ensureThreadReady = async () => {
      threadReady ??= ready.then(async () => {
        for (const plugin of plugins)
          await plugin.onThreadInit?.(createThreadOptions())
      })

      return threadReady
    }

    const runtime = createAgentRuntime({
      agentName: options.name,
      emit: (turnId, event) => emit(id, turnId, event, resolveContext),
      getContext: resolveContext,
      input: threadOptions.input,
      instructions: options.instructions,
      loadThread: async () => {
        await ensureThreadReady()

        for (const plugin of plugins) {
          const snapshot = await plugin.loadThread?.({
            ...createThreadOptions(),
            input: threadOptions.input ?? [],
          })

          if (snapshot != null)
            return snapshot
        }
      },
      onTurnDone: async (turnContext) => {
        for (const plugin of plugins)
          await plugin.onTurnDone?.(turnContext)
      },
      plugins,
      ready: async () => {
        await ensureThreadReady()
      },
      responseOptions: options.options,
      saveThread: async (threadContext) => {
        for (const plugin of plugins)
          await plugin.saveThread?.(threadContext)
      },
      threadId: id,
    })

    const subscribeThread: AgentThread<T>['subscribe'] = eventListener =>
      subscribe((event) => {
        if (event.threadId !== id)
          return

        eventListener(event)
      })

    const run: AgentThread<T>['run'] = (input, runOptions = {}) => {
      const turnId = crypto.randomUUID()
      let unsubscribe: (() => boolean) | undefined

      return new ReadableStream<AgentEvent>({
        cancel: () => {
          unsubscribe?.()
        },
        start: (controller) => {
          unsubscribe = subscribeThread((event) => {
            if (event.turnId !== turnId)
              return

            controller.enqueue(event)

            if (
              event.type === 'turn.aborted'
              || event.type === 'turn.done'
              || event.type === 'turn.failed'
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
    }

    const send: AgentThread<T>['send'] = (input, runOptions = {}) =>
      runtime.send({
        context: runOptions.context,
        input,
        signal: runOptions.signal,
      })

    const interrupt: AgentThread<T>['interrupt'] = (input, reason, runOptions = {}) =>
      runtime.interrupt({
        context: runOptions.context,
        input,
        signal: runOptions.signal,
      }, reason)

    const setThreadContext: AgentThread<T>['setContext'] = (nextContext) => {
      threadContext = merge(threadContext, nextContext)
    }

    return {
      abort: runtime.abort,
      clear: runtime.clear,
      getContext: () => resolveContext(),
      id,
      interrupt,
      run,
      send,
      setContext: setThreadContext,
      subscribe: subscribeThread,
    }
  }

  const thread: Agent<T>['thread'] = (threadOptions = {}) => {
    const id = threadOptions.id ?? crypto.randomUUID()
    const existing = threads.get(id)
    if (existing != null) {
      if (threadOptions.input != null)
        throw new Error(`Thread already exists: ${id}`)

      if (threadOptions.context != null)
        existing.setContext(threadOptions.context)

      return existing
    }

    const agentThread = createAgentThread(id, threadOptions)

    threads.set(id, agentThread)

    return agentThread
  }

  const defaultThread = thread({
    id: DEFAULT_THREAD_ID,
    input: options.input,
  })

  return {
    abort: reason => defaultThread.abort(reason),
    clear: () => defaultThread.clear(),
    getContext,
    interrupt: (input, reason, runOptions) => defaultThread.interrupt(input, reason, runOptions),
    run: (input, runOptions) => defaultThread.run(input, runOptions),
    send: (input, runOptions) => defaultThread.send(input, runOptions),
    setContext,
    subscribe,
    thread,
  }
}
