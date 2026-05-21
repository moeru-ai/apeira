import type { ResponsesOptions } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { ThreadState } from '../utils/thread-store'
import type { AgentContext } from './context'
import type { AgentEvent } from './event'
import type { ItemParam } from './responses'

export interface AgentPlugin<T = unknown> {
  enforce?: 'post' | 'pre'
  extendInstructions?: (options: ExtendInstructionsOptions<T>) => MaybePromise<string | void>
  name: string
  onEvent?: (event: AgentEvent) => MaybePromise<void>
  onFinish?: ResponsesOptions['onFinish']
  onStepFinish?: ResponsesOptions['onStepFinish']
  onThreadInit?: (options: ThreadInitOptions<T>) => MaybePromise<void>
  onTurnDone?: (options: TurnDoneOptions<T>) => MaybePromise<void>
  onTurnStart?: (options: TurnStartOptions<T>) => MaybePromise<void>
  prepareStep?: ResponsesOptions['prepareStep']
  resolveTools?: (options: ResolveToolsOptions<T>) => MaybePromise<Tool[] | void>
  setup?: (api: AgentPluginApi<T>) => MaybePromise<void>
  storage?: StorageLike
  version?: string
}

export interface AgentPluginApi<T = unknown> {
  emit: (channel: string, event: unknown) => void
  subscribe: (channel: string, listener: PluginChannelListener<T>) => () => boolean
}

export type AgentPluginOption<T = unknown>
  = | AgentPlugin<T>
    | AgentPluginOption<T>[]
    | false
    | null
    | undefined

export interface ExtendInstructionsOptions<T = unknown> {
  agentName: string
  context: AgentContext<T>
  input: ItemParam
  signal: AbortSignal
  threadId: string
  turnId: string
}

export type PluginChannelListener<T = unknown> = (
  event: unknown,
  options: PluginChannelListenerOptions<T>,
) => void

export interface PluginChannelListenerOptions<T = unknown> {
  channel: string
  pluginApi: AgentPluginApi<T>
}

export interface ResolveToolsOptions<T = unknown> extends ResponseOptions<T> {
  tools: readonly Tool[]
}

export interface ResponseOptions<T = unknown> {
  agentName: string
  context: AgentContext<T>
  input: readonly ItemParam[]
  signal: AbortSignal
  threadId: string
  turnId: string
  turnInput: ItemParam
}

export interface StorageLike {
  getItem: (key: string) => MaybePromise<null | string | undefined>
  removeItem?: (key: string) => MaybePromise<void>
  setItem: (key: string, value: string) => MaybePromise<void>
}

export interface ThreadInitOptions<T = unknown> {
  agentName: string
  context: AgentContext<T>
  threadId: string
}

export interface TurnDoneOptions<T = unknown> extends ResponseOptions<T> {
  snapshot: ThreadState<T>
}

export interface TurnStartOptions<T = unknown> {
  agentName: string
  context: AgentContext<T>
  input: ItemParam
  signal: AbortSignal
  threadId: string
  turnId: string
}

export type { ThreadState }

type MaybePromise<T> = Promise<T> | T
