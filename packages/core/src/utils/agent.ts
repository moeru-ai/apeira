import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'

import type { ApeiraEvent } from '../types/event'
import type { AgentEventListener } from '../types/event-listener'
import type { ItemParam } from '../types/responses'

import pLimit from 'p-limit'

import { responses, stepCountAtLeast } from '@xsai-ext/responses'

import { linkedAbort } from './linked-abort'

export interface Agent {
  abort: (reason?: unknown) => void
  clear: () => void
  submit: (input: ItemParam, signal?: AbortSignal) => string
  subscribe: (eventListener: AgentEventListener) => (() => boolean)
}

export interface AgentRunningTask {
  controller: AbortController
  id: string
  input: ItemParam
}

export interface CreateAgentOptions {
  input?: ItemParam[]
  instructions: string
  name: string
  options: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
}

export const createAgent = (options: CreateAgentOptions): Agent => {
  const eventListeners = new Set<AgentEventListener>()
  const pending = pLimit(1)

  let running: AgentRunningTask | undefined
  let history: ItemParam[] = options.input ?? []
  let historyVersion = 0

  const emit = (id: string, event: ApeiraEvent | XSAIEvent) =>
    eventListeners.forEach(fn => fn({ ...event, turnId: id }))

  const turn = async (id: string, input: ItemParam, signal?: AbortSignal) => {
    const controller = linkedAbort(signal)
    const version = historyVersion

    running = {
      controller,
      id,
      input,
    }

    try {
      const nextInput = [...history, input]

      emit(id, { type: 'turn.start' })

      const result = responses({
        ...options.options,
        abortSignal: controller.signal,
        input: nextInput,
        instructions: options.instructions,
        stopWhen: stepCountAtLeast(20),
      })

      void result.input.catch(() => undefined)
      void result.steps.catch(() => undefined)
      void result.usage.catch(() => undefined)
      void result.totalUsage.catch(() => undefined)

      for await (const event of result.eventStream) {
        emit(id, event)
      }

      if (version === historyVersion) {
        history = await result.input
      }

      emit(id, { type: 'turn.done' })
    }
    catch (error) {
      emit(id, controller.signal.aborted
        ? { reason: controller.signal.reason, type: 'turn.aborted' }
        : { error, type: 'turn.failed' })
    }
    finally {
      if (running?.id === id)
        running = undefined
    }
  }

  const submit: Agent['submit'] = (input, signal) => {
    const id = crypto.randomUUID()

    void pending(async () => turn(id, input, signal))

    return id
  }

  const subscribe: Agent['subscribe'] = (eventListener) => {
    eventListeners.add(eventListener)
    return () => eventListeners.delete(eventListener)
  }

  const abort: Agent['abort'] = (reason) => {
    running?.controller.abort(reason)
  }

  const clear: Agent['clear'] = () => {
    abort('cleared')
    pending.clearQueue()

    history = []
    historyVersion += 1

    // emit(crypto.randomUUID(), { type: 'turn.clear' })
  }

  return {
    abort,
    clear,
    submit,
    subscribe,
  }
}
