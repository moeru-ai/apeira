import type { ResponsesOptions } from '@xsai-ext/responses'

import type { Agent } from '../utils/agent'
import type { MaybePromise } from './base'

export interface AgentPlugin {
  enforce?: 'post' | 'pre'
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
