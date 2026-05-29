import type { CompletionToolCall } from '@xsai/shared-chat'

export type ApprovalDecision
  = | { reason?: string, type: 'reject' }
    | { type: 'approve' }
    | { type: 'pending' }

export type AutoReviewPolicy = (
  toolCall: CompletionToolCall,
  context: { toolPolicies?: Record<string, ToolPolicy> },
) => ApprovalDecision

export interface HITLAutoReviewedEvent extends HITLBaseEvent {
  decision: 'approve' | 'reject'
  reason?: string
  type: 'hitl.auto_reviewed'
}

export interface HITLBaseEvent {
  sessionId: string
  timestamp: number
  toolCallId: string
  toolName: string
  turnId: string
}

export type HITLEvent
  = | HITLAutoReviewedEvent
    | HITLRequestEvent
    | HITLResolvedEvent

export interface HITLRequestEvent extends HITLBaseEvent {
  args: string
  type: 'hitl.request'
}

export interface HITLResolvedEvent extends HITLBaseEvent {
  auto: boolean
  decision: 'approve' | 'reject'
  reason?: string
  type: 'hitl.resolved'
}

export interface HumanInTheLoopOptions {
  autoReview?: AutoReviewPolicy
  rejectionMessage?: RejectionMessageFn | string
  toolPolicies?: Record<string, ToolPolicy>
}

export type RejectionMessageFn = (
  toolCall: CompletionToolCall,
  reason?: string,
) => string

export interface ToolPolicy {
  needsApproval?: ((args: unknown) => boolean) | boolean
}
