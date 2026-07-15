import type { MaybePromise } from '../types'
import type { AgentCustomEvent } from './event'

export interface AgentChannel {
  emit: <K extends string>(channel: K, event: K extends keyof AgentCustomEvent ? AgentCustomEvent[K] : unknown, options?: { save?: boolean }) => MaybePromise<void>
  subscribe: <K extends string>(channel: K, listener: K extends keyof AgentCustomEvent ? AgentEventListener<AgentCustomEvent[K]> : AgentEventListener) => () => void
}

export type AgentEventListener<T = unknown> = (event: T) => MaybePromise<void>

export interface CreateAgentChannelOptions {
  persist: (event: unknown, options?: { save?: boolean }) => MaybePromise<void>
}

export const createAgentChannel = (options?: CreateAgentChannelOptions): AgentChannel => {
  const channels = new Map<string, Set<AgentEventListener>>()

  const emit: AgentChannel['emit'] = async (channel, event, emitOptions) => {
    const listeners = channels.get(channel)
    const promises: Promise<void>[] = []

    if (listeners) {
      promises.push(...Array.from(listeners).map(async (listener) => {
        try {
          await listener(event)
        }
        catch {}
      }))
    }

    if (emitOptions?.save && options?.persist)
      promises.push(Promise.resolve().then(async () => options.persist(event, emitOptions)))

    await Promise.all(promises)
  }

  const subscribe: AgentChannel['subscribe'] = (channel, listener) => {
    if (!channels.has(channel))
      channels.set(channel, new Set())

    const listeners = channels.get(channel)
    listeners!.add(listener as AgentEventListener)

    return () => {
      listeners!.delete(listener as AgentEventListener)
      if (listeners!.size === 0)
        channels.delete(channel)
    }
  }

  return {
    emit,
    subscribe,
  }
}
