import type {
  CompletionStep,
  PostToolCall,
  PrepareStep,
  PreToolCall,
  Tool,
  Usage,
} from '@xsai/shared-chat'

import type { Agent } from '../utils/agent'
import type { MaybePromise } from './base'
import type { AgentEntry } from './entry'
import type { AgentInput } from './input'
import type { AgentState } from './state'

export interface AgentPlugin {
  enforce?: 'post' | 'pre'
  extendInstructions?: (options: ExtendOptions) => MaybePromise<string | void>
  extendTools?: (options: ExtendOptions) => MaybePromise<Tool[] | void>
  init?: (agent: Agent) => MaybePromise<void>
  name: string
  onFinish?: (step?: CompletionStep) => MaybePromise<unknown>
  onStepFinish?: (step: CompletionStep) => MaybePromise<unknown>
  onTurnFinish?: (options: TurnFinishOptions) => MaybePromise<void>
  postToolCall?: PostToolCall
  prepareStep?: PrepareStep<AgentInput[], unknown>
  preToolCall?: PreToolCall
  stop?: () => MaybePromise<void>
  transformEntries?: (entries: readonly AgentEntry[], options: TransformEntriesOptions) => MaybePromise<readonly AgentEntry[]>
  version?: string
}

export type AgentPluginOption
  = | AgentPlugin
    | AgentPluginOption[]
    | false
    | null
    | undefined

export interface ExtendOptions {
  signal?: AbortSignal
  state: Readonly<AgentState>
  turnId: string
}

export interface TransformEntriesOptions extends ExtendOptions {}

export interface TurnFinishOptions {
  input: readonly AgentInput[]
  output: readonly AgentInput[]
  turnId: string
  usage?: Usage
}
