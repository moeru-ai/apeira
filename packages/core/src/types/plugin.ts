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
  postToolCall?: (options: PostToolCallOptions<T>) => MaybePromise<void>
  prepareStep?: ResponsesOptions['prepareStep']
  preToolCall?: (options: PreToolCallOptions<T>) => MaybePromise<PreToolCallResult | void>
  resolveTools?: (options: ResolveToolsOptions<T>) => MaybePromise<Tool[] | void>
  setup?: (api: AgentPluginApi) => MaybePromise<void>
  storage?: StorageLike
  version?: string
}

export interface AgentPluginApi {
  emit: {
    <K extends string>(channel: K, event: K extends keyof AgentChannelMap ? AgentChannelMap[K] : unknown): void
  }
  subscribe: {
    <K extends string>(channel: K, listener: K extends keyof AgentChannelMap ? PluginChannelListener<AgentChannelMap[K]> : PluginChannelListener): () => boolean
  }
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
  privateState?: PluginPrivateStateApi
  sessionId: string
  signal: AbortSignal
  turnId: string
}

export interface PluginPrivateStateApi {
  clear: () => void
  get: <TState = unknown>() => TState | undefined
  set: (state: unknown) => void
  update: <TState = unknown>(fn: (state: TState | undefined) => TState | undefined) => void
}

export interface PostToolCallOptions<T = unknown> extends PreToolCallOptions<T> {
  error?: unknown
  output?: unknown
  status: 'blocked' | 'error' | 'success'
}

export interface PreToolCallOptions<T = unknown> extends PluginHookBase<T> {
  input: unknown
  tool: Tool
  toolName: string
}

export type PreToolCallResult
  = | { output?: unknown, reason?: string, type: 'block' }
    | { type: 'continue' }

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
  plugins?: Record<string, unknown>
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
