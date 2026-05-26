import type { ResponsesOptions } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { Episodic } from '../episodic'
import type { AgentContext, ItemParam, MaybePromise } from './base'
import type { AgentEvent } from './event'

export interface AgentChannelMap {
  apeira: AgentEvent
}

export interface AgentPlugin<T = unknown> {
  enforce?: 'post' | 'pre'
  extendInput?: (options: ExtendInputOptions<T>) => MaybePromise<ItemParam[] | void>
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

export interface AgentPluginApi extends ChannelApi {}

export type AgentPluginOption<T = unknown>
  = | AgentPlugin<T>
    | AgentPluginOption<T>[]
    | false
    | null
    | undefined

export interface ChannelApi {
  emit: {
    <K extends string>(channel: K, event: K extends keyof AgentChannelMap ? AgentChannelMap[K] : unknown): void
  }
  subscribe: {
    <K extends string>(channel: K, listener: K extends keyof AgentChannelMap ? PluginChannelListener<AgentChannelMap[K]> : PluginChannelListener): () => boolean
  }
}

export interface ExtendInputOptions<T = unknown> extends PluginHookBase<T> {
  episodic: Episodic
  input: readonly ItemParam[]
  turnInput: ItemParam
}

export interface ExtendInstructionsOptions<T = unknown> extends PluginHookBase<T> {
  turnInput: ItemParam
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
  episodic: string
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
  turnInput: ItemParam
}
