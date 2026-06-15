import type { MaybePromise } from '../types/base'
import type { AgentCustomEvent } from '../types/event'

export interface AgentChannel {
  emit: <K extends string>(channel: K, event: K extends keyof AgentCustomEvent ? AgentCustomEvent[K] : unknown) => MaybePromise<void>
  subscribe: <K extends string>(channel: K, listener: K extends keyof AgentCustomEvent ? AgentEventListener<AgentCustomEvent[K]> : AgentEventListener) => () => void
}

export type AgentEventListener<T = unknown> = (event: T) => MaybePromise<void>

export const createAgentChannel = (): AgentChannel => {
  const channels = new Map<string, Set<AgentEventListener>>()

  const emit: AgentChannel['emit'] = async (channel, event) => {
    const listeners = channels.get(channel)
    if (!listeners)
      return

    await Promise.all(Array.from(listeners).map(async (listener) => {
      try {
        await listener(event)
      }
      catch {}
    }))
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
