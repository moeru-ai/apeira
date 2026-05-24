import type { AgentContext } from '../types/context'
import type { AgentEvent } from '../types/event'
import type { AgentChannelMap, PluginChannelListener } from '../types/plugin'
import type { ItemParam } from '../types/responses'

export interface AgentRunOptions<T> {
  context?: Partial<AgentContext<T>>
  signal?: AbortSignal
}

export interface AgentSession<T> {
  abort: (reason?: unknown) => void
  clear: () => void
  emit: (channel: string, event: unknown) => void
  fork: (options?: SessionForkOptions<T>) => Promise<AgentSession<T>>
  getContext: () => AgentContext<T>
  readonly id: string
  interrupt: (reason?: unknown) => void
  remove: () => Promise<void>
  run: (input: ItemParam, options?: AgentRunOptions<T>) => ReadableStream<AgentEvent>
  send: (input: ItemParam, options?: AgentRunOptions<T>) => string
  setContext: (context: Partial<AgentContext<T>>) => void
  subscribe: ((channel: string, listener: PluginChannelListener) => () => boolean) & (<K extends keyof AgentChannelMap>(channel: K, listener: PluginChannelListener<AgentChannelMap[K]>) => () => boolean)
}

export interface SessionForkOptions<T> {
  context?: Partial<AgentContext<T>>
  id?: string
}
