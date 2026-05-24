import type { ResponsesOptions } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { AgentContext } from './context'
import type { AgentEvent } from './event'
import type { MaybePromise } from './maybe-promise'
import type { ItemParam } from './responses'

export interface AgentChannelMap {
  apeira: AgentEvent
}

export interface AgentPlugin<T = unknown> {
  enforce?: 'post' | 'pre'
  extendInstructions?: (options: ExtendInstructionsOptions<T>) => MaybePromise<string | void>
  name: string
  onEvent?: (event: AgentEvent) => MaybePromise<void>
  onFinish?: ResponsesOptions['onFinish']
  onSessionInit?: (options: SessionInitOptions<T>) => MaybePromise<void>
  onStepFinish?: ResponsesOptions['onStepFinish']
  onTurnDone?: (options: TurnDoneOptions<T>) => MaybePromise<void>
  onTurnStart?: (options: TurnStartOptions<T>) => MaybePromise<void>
  prepareStep?: ResponsesOptions['prepareStep']
  resolveTools?: (options: ResolveToolsOptions<T>) => MaybePromise<Tool[] | void>
  setup?: (api: AgentPluginApi) => MaybePromise<void>
  storage?: StorageLike
  version?: string
}

export interface AgentPluginApi {
  emit: (channel: string, event: unknown) => void
  subscribe: ((channel: string, listener: PluginChannelListener) => () => boolean) & (<K extends keyof AgentChannelMap>(channel: K, listener: PluginChannelListener<AgentChannelMap[K]>) => () => boolean)
}

export type AgentPluginOption<T = unknown>
  = | AgentPlugin<T>
    | AgentPluginOption<T>[]
    | false
    | null
    | undefined

export interface ExtendInstructionsOptions<T = unknown> extends PluginHookBase<T> {
  input: ItemParam
}

export type PluginChannelListener<T = unknown> = (event: T) => void

export interface PluginHookBase<T = unknown> {
  agentName: string
  context: AgentContext<T>
  sessionId: string
  signal: AbortSignal
  turnId: string
}

export interface ResolveToolsOptions<T = unknown> extends ResponseOptions<T> {
  tools: readonly Tool[]
}

export interface ResponseOptions<T = unknown> extends PluginHookBase<T> {
  input: readonly ItemParam[]
  turnInput: ItemParam
}

export interface SessionInitOptions<T = unknown> {
  agentName: string
  context: AgentContext<T>
  sessionId: string
}

export interface SessionState<T = unknown> {
  context: Partial<AgentContext<T>>
  items: ItemParam[]
  version: number
}

export interface StorageLike {
  getItem: (key: string) => MaybePromise<null | string | undefined>
  removeItem: (key: string) => MaybePromise<void>
  setItem: (key: string, value: string) => MaybePromise<void>
}

export interface TurnDoneOptions<T = unknown> extends ResponseOptions<T> {
  snapshot: SessionState<T>
}

export interface TurnStartOptions<T = unknown> extends PluginHookBase<T> {
  input: ItemParam
}
