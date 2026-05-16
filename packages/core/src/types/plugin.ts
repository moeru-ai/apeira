import type { ResponsesOptions } from '@xsai-ext/responses'
import type { CompletionStep, Tool } from '@xsai/shared-chat'

import type { ThreadSnapshot } from '../utils/thread-store'
import type { AgentContext } from './context'
import type { AgentEvent } from './event'
import type { ItemParam } from './responses'

export interface ApeiraPlugin<T = unknown> {
  enforce?: 'post' | 'pre'
  loadThread?: (context: ThreadLoadContext<T>) => MaybePromise<ThreadSnapshot | void>
  name: string
  onEvent?: (event: AgentEvent, context: EventContext<T>) => MaybePromise<void>
  onFinish?: (step: CompletionStep | undefined, context: ResponseContext<T>) => MaybePromise<void>
  onStepFinish?: (step: CompletionStep, context: ResponseContext<T>) => MaybePromise<void>
  onThreadCreate?: (context: ThreadCreateContext<T>) => MaybePromise<void>
  onTurnDone?: (context: TurnDoneContext<T>) => MaybePromise<void>
  onTurnStart?: (context: TurnStartContext<T>) => MaybePromise<void>
  prepareStep?: (
    options: PrepareStepOptions,
    context: ResponseContext<T>,
  ) => MaybePromise<PrepareStepResult | void>
  resolveTools?: (context: ResolveToolsContext<T>) => MaybePromise<Tool[] | void>
  saveThread?: (context: ThreadSaveContext<T>) => MaybePromise<void>
  setup?: (api: ApeiraPluginApi<T>) => MaybePromise<void>
  version?: string
}

export interface ApeiraPluginApi<T = unknown> {
  emit: (channel: string, event: unknown) => void
  subscribe: (channel: string, listener: PluginChannelListener<T>) => () => boolean
}

export type ApeiraPluginOption<T = unknown>
  = | ApeiraPlugin<T>
    | ApeiraPluginOption<T>[]
    | false
    | null
    | undefined

export interface EventContext<T = unknown> {
  agentName: string
  getContext: () => AgentContext<T>
  threadId: string
  turnId: string
}

export type PluginChannelListener<T = unknown> = (
  event: unknown,
  context: { channel: string, pluginApi: ApeiraPluginApi<T> },
) => void

export interface ResolveToolsContext<T = unknown> extends TurnStartContext<T> {
  tools: readonly Tool[]
}

export interface ResponseContext<T = unknown> {
  agentName: string
  context: AgentContext<T>
  signal: AbortSignal
  threadId: string
  turnId: string
}

export interface ThreadCreateContext<T = unknown> {
  agentName: string
  context: AgentContext<T>
  threadId: string
}

export interface ThreadLoadContext<T = unknown> extends ThreadCreateContext<T> {
  input: readonly ItemParam[]
}

export interface ThreadSaveContext<T = unknown> extends ThreadCreateContext<T> {
  snapshot: ThreadSnapshot
}

export interface TurnDoneContext<T = unknown> extends TurnStartContext<T> {
  snapshot: ThreadSnapshot
}

export interface TurnStartContext<T = unknown> {
  agentName: string
  context: AgentContext<T>
  input: ItemParam
  signal: AbortSignal
  threadId: string
  turnId: string
}

type MaybePromise<T> = Promise<T> | T

type PrepareStepOptions = Parameters<NonNullable<ResponsesOptions['prepareStep']>>[0]

type PrepareStepResult = Awaited<ReturnType<NonNullable<ResponsesOptions['prepareStep']>>>
