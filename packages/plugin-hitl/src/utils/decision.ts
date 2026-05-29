import type { CompletionToolCall } from '@xsai/shared-chat'

import type { ApprovalDecision, AutoReviewPolicy, ToolPolicy } from '../types'

const parseToolArgs = (toolCall: CompletionToolCall): unknown => {
  try {
    return JSON.parse(toolCall.args)
  }
  catch {
    return undefined
  }
}

export const resolveDecision = (
  toolCall: CompletionToolCall,
  options: {
    autoReview?: AutoReviewPolicy
    toolPolicies?: Record<string, ToolPolicy>
  },
): ApprovalDecision => {
  const policy = options.toolPolicies?.[toolCall.toolName]

  if (policy?.needsApproval != null) {
    if (typeof policy.needsApproval === 'boolean')
      return policy.needsApproval ? { type: 'pending' } : { type: 'approve' }

    try {
      return policy.needsApproval(parseToolArgs(toolCall))
        ? { type: 'pending' }
        : { type: 'approve' }
    }
    catch {
      return { type: 'pending' }
    }
  }

  if (options.autoReview != null) {
    try {
      return options.autoReview(toolCall, { toolPolicies: options.toolPolicies })
    }
    catch {
      return { type: 'pending' }
    }
  }

  return { type: 'pending' }
}
