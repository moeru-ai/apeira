import type { ResponsesOptions } from '@xsai-ext/responses'
import type {
  CompletionStep,
  PostToolCall,
  PrepareStep,
  PreToolCall,
  Tool,
  Usage,
} from '@xsai/shared-chat'
import type { StreamTextOptions } from '@xsai/stream-text'

import type { AgentChannel } from '../utils/channel'
import type { AgentInput } from './input'

export type ChatRunnerOptions = Omit<StreamTextOptions, DynamicOptions>

export type ResponsesRunnerOptions = Omit<ResponsesOptions, DynamicOptions>

export type Runner = (context: RunnerContext) => Promise<RunnerResult>

export interface RunnerContext {
  abortSignal?: AbortSignal
  channel: AgentChannel
  input: AgentInput[]
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

type DynamicOptions
  = | 'abortSignal'
    | 'input'
    | 'instructions'
    | 'messages'
    | 'onFinish'
    | 'onStepFinish'
    | 'postToolCall'
    | 'prepareStep'
    | 'preToolCall'
