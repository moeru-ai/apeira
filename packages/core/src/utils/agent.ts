import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { AgentEvent } from '../types/event'
import type { AgentEventListener } from '../types/event-listener'
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
}

type CreateAgentContextOptions<T> = [RequiredKeys<T>] extends [never]
  ? { context?: AgentContext<T> }
  : { context: AgentContext<T> }

type RequiredKeys<T> = {
  [K in keyof T]-?: Record<never, never> extends Pick<T, K> ? never : K
}[keyof T]

const DEFAULT_THREAD_ID = 'default'

export const createAgent = <T = unknown>(options: CreateAgentOptions<T>): Agent<T> => {
  const eventListeners = new Set<AgentEventListener>()
  const threads = new Map<string, AgentThread<T>>()

  let context: AgentContext<T> = options.context ?? {} as AgentContext<T>

  const emit = (threadId: string, turnId: string, event: Omit<AgentEvent, 'threadId' | 'turnId'>) => {
    for (const fn of [...eventListeners]) {
      try {
        fn({ ...event, threadId, turnId } as AgentEvent)
      }
      catch {}
    }
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

    const runtime = createAgentRuntime({
      emit: (turnId, event) => emit(id, turnId, event),
      getContext: resolveContext,
      input: threadOptions.input,
      instructions: options.instructions,
      responseOptions: options.options,
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
      if (threadOptions.context != null || threadOptions.input != null)
        throw new Error(`Thread already exists: ${id}`)

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

  const run: Agent<T>['run'] = (input, runOptions) =>
    defaultThread.run(input, runOptions)

  const abort: Agent<T>['abort'] = reason =>
    defaultThread.abort(reason)

  const clear: Agent<T>['clear'] = () =>
    defaultThread.clear()

  const interrupt: Agent<T>['interrupt'] = (input, reason, runOptions) =>
    defaultThread.interrupt(input, reason, runOptions)

  const send: Agent<T>['send'] = (input, runOptions) =>
    defaultThread.send(input, runOptions)

  return {
    abort,
    clear,
    getContext,
    interrupt,
    run,
    send,
    setContext,
    subscribe,
    thread,
  }
}
