import type { AgentPlugin } from '@apeira/core'
import type {
  EscalationAuthorizer,
  EscalationRequest,
  SandboxProfile,
} from '@apeira/plugin-sandbox'
import type { CompletionToolCall } from '@xsai/shared-chat'

export type HITLCancellationReason = 'aborted' | 'stopped' | 'turn_finished'

export interface HITLCancelledEvent {
  reason: HITLCancellationReason
  request: HITLRequest
  type: 'cancelled'
}

export type HITLDecision
  = | { abortTurn?: boolean, message?: string, type: 'reject' }
    | { args: string, type: 'edit' }
    | { scope?: 'once' | 'session', type: 'approve' }

export type HITLEvent
  = | HITLCancelledEvent
    | HITLRequestEvent
    | HITLResolvedEvent

export type HITLOption
  = | 'approve'
    | 'approve_session'
    | 'edit'
    | 'reject'
    | 'reject_abort'

export interface HITLOptions {
  policies?: HITLPolicy[]
  rejectionMessage?: RejectionMessageFn | string
}

export interface HITLPlugin extends AgentPlugin {
  authorizeEscalation: EscalationAuthorizer
  listPending: (options?: { turnId?: string }) => readonly HITLRequest[]
  resolve: (requestId: string, decision: HITLDecision) => boolean
}

export type HITLPolicy = (
  request: Readonly<HITLRequest>,
) => HITLPolicyResult | Promise<HITLPolicyResult | undefined> | undefined

export interface HITLPolicyResult {
  reason?: string
  type: 'allow' | 'ask' | 'deny'
}

export type HITLRequest = PermissionRequest | ToolRequest

export interface HITLRequestBase {
  createdAt: number
  options: readonly HITLOption[]
  requestId: string
  turnId: string
}

export interface HITLRequestEvent {
  request: HITLRequest
  type: 'request'
}

export interface HITLResolvedEvent {
  decision: HITLDecision
  request: HITLRequest
  source: 'policy' | 'session' | 'user'
  type: 'resolved'
}

export interface PermissionRequest extends HITLRequestBase {
  command: string
  cwd?: string
  defaultProfile: Readonly<SandboxProfile>
  escalation: EscalationRequest
  executionRequestId: string
  type: 'permission'
}

export type RejectionMessageFn = (
  toolCall: CompletionToolCall,
  reason?: string,
) => string

export type ToolNamePattern = RegExp | string

export interface ToolPolicyOptions {
  allow?: ToolNamePattern[]
  deny?: ToolNamePattern[]
  denyReason?: string
}

export interface ToolRequest extends HITLRequestBase {
  toolCall: CompletionToolCall
  type: 'tool'
}
