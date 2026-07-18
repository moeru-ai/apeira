import type { AgentInput, AgentPlugin, Runner } from '@apeira/core'
import type {
  EscalationAuthorizer,
  EscalationRequest,
  SandboxProfile,
} from '@apeira/plugin-sandbox'
import type { CompletionToolCall } from '@xsai/shared-chat'

export interface HITLAssessment {
  rationale: string
  riskLevel: 'critical' | 'high' | 'low' | 'medium'
  type: 'approve' | 'deny'
  userAuthorization: 'high' | 'low' | 'medium' | 'unknown'
}

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
    | HITLReviewFailedEvent
    | HITLReviewingEvent

export type HITLOption
  = | 'approve'
    | 'approve_session'
    | 'edit'
    | 'reject'
    | 'reject_abort'

export interface HITLOptions {
  policies?: HITLPolicy[]
  rejectionMessage?: RejectionMessageFn | string
  reviewer?: HITLReviewer
}

export interface HITLPlugin extends AgentPlugin {
  authorizeEscalation: EscalationAuthorizer
  listPending: (options?: { turnId?: string }) => readonly HITLRequest[]
  resolve: (requestId: string, decision: HITLDecision) => boolean
  readonly reviewer: 'user' | HITLReviewer
  setReviewer: (reviewer: 'user' | HITLReviewer) => void
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
  assessment?: HITLAssessment
  request: HITLRequest
  type: 'request'
}

export interface HITLResolvedEvent {
  assessment?: HITLAssessment
  decision: HITLDecision
  failure?: HITLReviewFailure
  request: HITLRequest
  source: 'policy' | 'reviewer' | 'reviewer_failure' | 'session' | 'user'
  type: 'resolved'
}

export interface HITLReviewContext {
  input: readonly AgentInput[]
  runner: Runner
  signal?: AbortSignal
}

export interface HITLReviewer {
  name: string
  onDeny?: HITLReviewRoute
  onFailure?: HITLReviewRoute
  review: (
    request: Readonly<HITLRequest>,
    context: HITLReviewContext,
  ) => HITLReviewResult | Promise<HITLReviewResult>
}

export interface HITLReviewFailedEvent {
  failure: HITLReviewFailure
  request: HITLRequest
  reviewer: string
  type: 'review_failed'
}

export interface HITLReviewFailure {
  message?: string
  type: 'invalid_result' | 'reviewer_error' | 'runner' | 'timeout'
}

export interface HITLReviewingEvent {
  request: HITLRequest
  reviewer: string
  type: 'reviewing'
}

export type HITLReviewResult = HITLAssessment | { failure: HITLReviewFailure, type: 'failure' }

export type HITLReviewRoute = 'ask' | 'deny'

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
