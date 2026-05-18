import type { AgentContext } from '../types/context'
import type { AgentEvent } from '../types/event'
import type { AgentEventListener } from '../types/event-listener'
import type { PluginChannelListener } from '../types/plugin'
import type { ItemParam } from '../types/responses'

export interface AgentRunOptions<T> {
  context?: Partial<AgentContext<T>>
  signal?: AbortSignal
}

export interface AgentThread<T> {
  abort: (reason?: unknown) => void
  clear: () => void
  emit: (channel: string, event: unknown) => void
  getContext: () => AgentContext<T>
  readonly id: string
  interrupt: (input: ItemParam, reason?: unknown, options?: AgentRunOptions<T>) => string
  on: (eventListener: AgentEventListener) => () => boolean
  run: (input: ItemParam, options?: AgentRunOptions<T>) => ReadableStream<AgentEvent>
  send: (input: ItemParam, options?: AgentRunOptions<T>) => string
  setContext: (context: Partial<AgentContext<T>>) => void
  subscribe: (channel: string, listener: PluginChannelListener<T>) => () => boolean
}
