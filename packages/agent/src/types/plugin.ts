import type { ResponsesOptions } from '@xsai-ext/responses'

export interface AgentPlugin {
  enforce?: 'post' | 'pre'
  name: string
  onFinish?: ResponsesOptions['onFinish']
  onStepFinish?: ResponsesOptions['onStepFinish']
  postToolCall?: ResponsesOptions['postToolCall']
  prepareStep?: ResponsesOptions['prepareStep']
  preToolCall?: ResponsesOptions['preToolCall']
  version?: string
}
