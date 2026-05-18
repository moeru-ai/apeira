import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { AgentEvent } from '../types/event'
import type { AgentEventListener } from '../types/event-listener'
import type { AgentPlugin, AgentPluginApi, AgentPluginOption, PluginChannelListener, ThreadInitOptions, ThreadState } from '../types/plugin'
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

const getThreadStorageKey = (agentName: string, threadId: string) =>
  JSON.stringify([agentName, threadId])

const parseThreadState = <T>(value: null | string | undefined): ThreadState<T> | undefined => {
  if (value == null)
    return undefined

  try {
    return JSON.parse(value) as ThreadState<T>
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
        await plugin.onEvent?.(fullEvent)
    }).catch(() => undefined)
  }

  const getContext: Agent<T>['getContext'] = () => context

  const setContext: Agent<T>['setContext'] = nextContext =>
    context = merge(context, nextContext)

  const emitChannel: Agent<T>['emit'] = (channel, event) =>
    pluginApi.emit(channel, event)

  const on: Agent<T>['on'] = (eventListener) => {
    eventListeners.add(eventListener)
    return () => eventListeners.delete(eventListener)
  }

  const subscribe: Agent<T>['subscribe'] = (channel, listener) =>
    pluginApi.subscribe(channel, listener)

  const createAgentThread = (id: string, threadOptions: ThreadOptions<T> = {}): AgentThread<T> => {
    const storagePlugins = plugins.filter(plugin => plugin.storage != null)
    const initialThreadContext = threadOptions.context ?? {}

    let currentThreadContext = initialThreadContext

    const resolveContext = (runContext?: Partial<AgentContext<T>>): AgentContext<T> =>
      merge(merge(context, currentThreadContext), runContext)

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

    const loadThread = async (): Promise<ThreadState<T> | undefined> => {
      await ensureThreadReady()

      for (const plugin of storagePlugins) {
        const value = await plugin.storage?.getItem(getThreadStorageKey(options.name, id))
        const state = parseThreadState<T>(value)

        if (state != null) {
          const mergedState = {
            ...state,
            context: merge(initialThreadContext, state.context),
          } satisfies ThreadState<T>

          currentThreadContext = mergedState.context
          return mergedState
        }
      }
    }

    const saveThread = async (state: ThreadState<T>) => {
      currentThreadContext = state.context

      for (const plugin of storagePlugins) {
        const storage = plugin.storage
        if (storage == null)
          continue

        await storage.setItem(getThreadStorageKey(options.name, id), JSON.stringify(state))
      }
    }

    const runtime = createAgentRuntime({
      agentName: options.name,
      emit: (turnId, event) => emit(id, turnId, event),
      getContext: resolveContext,
      input: threadOptions.input,
      instructions: options.instructions,
      loadThread,
      onTurnDone: async (turnContext) => {
        for (const plugin of plugins)
          await plugin.onTurnDone?.(turnContext)
      },
      plugins,
      ready: async () => {
        await ensureThreadReady()
      },
      responseOptions: options.options,
      saveThread,
      threadContext: initialThreadContext,
      threadId: id,
    })

    const onThread: AgentThread<T>['on'] = eventListener =>
      on((event) => {
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
          unsubscribe = onThread((event) => {
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
      currentThreadContext = merge(currentThreadContext, nextContext)
      runtime.setContext(nextContext)
    }

    return {
      abort: runtime.abort,
      clear: runtime.clear,
      emit: emitChannel,
      getContext: () => resolveContext(),
      id,
      interrupt,
      on: onThread,
      run,
      send,
      setContext: setThreadContext,
      subscribe,
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
    emit: emitChannel,
    getContext,
    interrupt: (input, reason, runOptions) => defaultThread.interrupt(input, reason, runOptions),
    on,
    run: (input, runOptions) => defaultThread.run(input, runOptions),
    send: (input, runOptions) => defaultThread.send(input, runOptions),
    setContext,
    subscribe,
    thread,
  }
}
