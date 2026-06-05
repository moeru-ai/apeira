import type { ResponsesOptions } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { Agent } from '../utils/agent'
import type { MaybePromise } from './base'
import type { AgentState } from './state'

export interface AgentPlugin {
  enforce?: 'post' | 'pre'
  extendInstructions?: (options: ExtendOptions) => MaybePromise<string | void>
  extendTools?: (options: ExtendOptions) => MaybePromise<Tool[] | void>
  init?: (agent: Agent) => MaybePromise<void>
  name: string
  onFinish?: ResponsesOptions['onFinish']
  onStepFinish?: ResponsesOptions['onStepFinish']
  postToolCall?: ResponsesOptions['postToolCall']
  prepareStep?: ResponsesOptions['prepareStep']
  preToolCall?: ResponsesOptions['preToolCall']
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
