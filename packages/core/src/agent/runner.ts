import type {
  CompletionStep,
  PostToolCall,
  PrepareStep,
  PreToolCall,
  Tool,
  Usage,
} from '@xsai/shared-chat'

import type { AgentChannel } from './channel'
import type { AgentInput } from './input'

export type DynamicOptions
  = | 'abortSignal'
    | 'input'
    | 'instructions'
    | 'messages'
    | 'onFinish'
    | 'onStepFinish'
    | 'postToolCall'
    | 'prepareStep'
    | 'preToolCall'
    | 'tools'

export type Runner = (context: RunnerContext) => Promise<RunnerResult>

export interface RunnerContext {
  abortSignal?: AbortSignal
  channel: AgentChannel
  input: readonly AgentInput[]
  instructions: string
  onFinish?: (step?: CompletionStep) => Promise<unknown> | unknown
  onStepFinish?: (step: CompletionStep) => Promise<unknown> | unknown
  postToolCall?: PostToolCall
  prepareStep?: PrepareStep<AgentInput[], unknown>
  preToolCall?: PreToolCall
  tools: Tool[]
  turnId: string
}

export interface RunnerResult {
  output: AgentInput[]
  usage?: Usage
}
