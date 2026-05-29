import type { CompletionToolCall, CompletionToolResult } from '@xsai/shared-chat'

import type { RejectionMessageFn } from '../types'

const defaultRejectionMessage: RejectionMessageFn = (_toolCall, reason) =>
  reason == null || reason.trim().length === 0
    ? 'Tool execution was not approved.'
    : `Tool execution was not approved. Reason: ${reason}`

const parseArgs = (args: string) => {
  try {
    const parsed = JSON.parse(args) as unknown
    return parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  }
  catch {
    return {}
  }
}

export const resolveRejectionMessage = (
  toolCall: CompletionToolCall,
  rejectionMessage: RejectionMessageFn | string | undefined,
  reason?: string,
) => typeof rejectionMessage === 'function'
  ? rejectionMessage(toolCall, reason)
  : rejectionMessage ?? defaultRejectionMessage(toolCall, reason)

export const buildRejectionResult = (
  toolCall: CompletionToolCall,
  rejectionMessage: RejectionMessageFn | string | undefined,
  reason?: string,
): CompletionToolResult => ({
  args: parseArgs(toolCall.args),
  result: resolveRejectionMessage(toolCall, rejectionMessage, reason),
  toolCallId: toolCall.toolCallId,
  toolName: toolCall.toolName,
})
