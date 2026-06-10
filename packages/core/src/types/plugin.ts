import type {
  CompletionStep,
  PostToolCall,
  PrepareStep,
  PreToolCall,
  Tool,
} from '@xsai/shared-chat'

import type { Agent } from '../utils/agent'
import type { MaybePromise } from './base'
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
  postToolCall?: PostToolCall
  prepareStep?: PrepareStep<AgentInput[], unknown>
  preToolCall?: PreToolCall
  stop?: () => MaybePromise<void>
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
  state: AgentState
  turnId: string
}
