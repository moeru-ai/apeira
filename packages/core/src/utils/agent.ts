import type { ResponsesOptions } from '@xsai-ext/responses'

import type { AgentContext } from '../types/context'
import type { AgentEvent } from '../types/event'
import type { AgentEventListener } from '../types/event-listener'
import type { ItemParam } from '../types/responses'

import { createAgentRuntime } from './agent-runtime'

export interface Agent<T> {
  abort: (reason?: unknown) => void
  clear: () => void
  getContext: () => AgentContext<T>
  interrupt: (input: ItemParam, reason?: unknown) => string
  run: (input: ItemParam, signal?: AbortSignal) => ReadableStream<AgentEvent>
  send: (input: ItemParam, signal?: AbortSignal) => string
  subscribe: (eventListener: AgentEventListener) => (() => boolean)
}

export type CreateAgentOptions<T = unknown> = CreateAgentBaseOptions<T> & CreateAgentContextOptions<T>

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

export const createAgent = <T = unknown>(options: CreateAgentOptions<T>): Agent<T> => {
  const eventListeners = new Set<AgentEventListener>()

  const context: AgentContext<T> = options.context ?? {} as AgentContext<T>
  const getContext: Agent<T>['getContext'] = () => context

  const runtime = createAgentRuntime({
    context,
    emit: (id, event) => {
      for (const fn of [...eventListeners]) {
        try {
          fn({ ...event, turnId: id })
        }
        catch {}
      }
    },
    input: options.input,
    instructions: options.instructions,
    responseOptions: options.options,
  })

  const subscribe: Agent<T>['subscribe'] = (eventListener) => {
    eventListeners.add(eventListener)
    return () => eventListeners.delete(eventListener)
  }

  const run: Agent<T>['run'] = (input, signal) => {
    const id = crypto.randomUUID()
    let unsubscribe: (() => boolean) | undefined

    return new ReadableStream<AgentEvent>({
      cancel: () => {
        unsubscribe?.()
      },
      start: (controller) => {
        unsubscribe = subscribe((event) => {
          if (event.turnId !== id)
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

        runtime.enqueueTurn(id, input, signal)
      },
    })
  }

  const abort: Agent<T>['abort'] = reason =>
    runtime.abort(reason)

  const clear: Agent<T>['clear'] = () =>
    runtime.clear()

  const interrupt: Agent<T>['interrupt'] = (input, reason) =>
    runtime.interrupt(input, reason)

  const send: Agent<T>['send'] = (input, signal) =>
    runtime.send(input, signal)

  return {
    abort,
    clear,
    getContext,
    interrupt,
    run,
    send,
    subscribe,
  }
}
