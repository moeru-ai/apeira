import type { XSAIErrorCode } from '@xsai/shared'

import { XSAIError } from '@xsai/shared'

export type AgentErrorCode
  = | 'agent_cancelled'
    | 'agent_interrupted'
    | 'agent_reset_while_running'

export class AgentError extends XSAIError {
  readonly agentCode: AgentErrorCode

  constructor(message: string, code: AgentErrorCode, options?: ErrorOptions) {
    super(message, code as XSAIErrorCode, options)
    this.agentCode = code
  }
}

export class AgentCancelledError extends AgentError {
  readonly reason?: unknown
  readonly submissionId?: string

  constructor(message = 'Agent run cancelled', options: {
    reason?: unknown
    submissionId?: string
  } = {}) {
    super(message, 'agent_cancelled', { cause: options.reason })
    this.reason = options.reason
    this.submissionId = options.submissionId
  }
}

export class AgentInterruptedError extends AgentError {
  readonly reason?: unknown
  readonly submissionId?: string

  constructor(message = 'Agent run interrupted', options: {
    reason?: unknown
    submissionId?: string
  } = {}) {
    super(message, 'agent_interrupted', { cause: options.reason })
    this.reason = options.reason
    this.submissionId = options.submissionId
  }
}
