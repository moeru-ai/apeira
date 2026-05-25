import type { AgentContext, ItemParam } from '../types/base'
import type { AgentEvent } from '../types/event'
import type { AgentChannelMap, ChannelApi, PluginChannelListener } from '../types/plugin'

export interface AgentRunOptions<T> {
  context?: Partial<AgentContext<T>>
  signal?: AbortSignal
}

export interface AgentSession<T> extends ChannelApi {
  abort: (reason?: unknown) => void
  clear: () => void
  fork: (options?: SessionForkOptions<T>) => Promise<AgentSession<T>>
  getContext: () => AgentContext<T>
  readonly id: string
  interrupt: (reason?: unknown) => void
  remove: () => Promise<void>
  run: (input: ItemParam, options?: AgentRunOptions<T>) => ReadableStream<AgentEvent>
  send: (input: ItemParam, options?: AgentRunOptions<T>) => string
  setContext: (context: Partial<AgentContext<T>>) => void
}

export interface SessionForkOptions<T> {
  context?: Partial<AgentContext<T>>
  id?: string
}
