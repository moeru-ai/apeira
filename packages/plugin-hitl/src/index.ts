import type { AgentPlugin, AgentPluginApi } from '@apeira/core'
import type { CompletionToolCall, CompletionToolResult } from '@xsai/shared-chat'

import type { ApprovalDecision, HITLEvent, HumanInTheLoopOptions } from './types'

import { name, version } from '../package.json'
import { resolveDecision } from './utils/decision'
import { createDeferred } from './utils/deferred'
import { buildRejectionResult } from './utils/message'
import { autoReviewByPattern } from './utils/policy'

export type {
  ApprovalDecision,
  AutoReviewPolicy,
  HITLAutoReviewedEvent,
  HITLBaseEvent,
  HITLEvent,
  HITLRequestEvent,
  HITLResolvedEvent,
  HumanInTheLoopOptions,
  RejectionMessageFn,
  ToolPolicy,
} from './types'

declare module '@apeira/core' {
  interface AgentChannelMap {
    hitl: HITLEvent
  }
}

interface PendingResolution {
  deferred: ReturnType<typeof createDeferred<CompletionToolCall | CompletionToolResult>>
  emit: (event: HITLEvent) => void
  event: {
    sessionId: string
    timestamp: number
    toolCallId: string
    toolName: string
    turnId: string
  }
  key: string
  rejectionMessage: HumanInTheLoopOptions['rejectionMessage']
  toolCall: CompletionToolCall
}

const pendingByKey = new Map<string, PendingResolution>()
const pendingKeyByToolCallId = new Map<string, string>()
const turnContextBySignal = new WeakMap<AbortSignal, { sessionId: string, turnId: string }>()

const resolvePending = (
  toolCallId: string,
  resolution: ApprovalDecision,
): boolean => {
  const key = pendingKeyByToolCallId.get(toolCallId)
  const pending = key == null ? undefined : pendingByKey.get(key)

  if (pending == null)
    return false

  if (resolution.type === 'approve') {
    pending.deferred.resolve(pending.toolCall)
  }
  else if (resolution.type === 'reject') {
    pending.deferred.resolve(buildRejectionResult(
      pending.toolCall,
      pending.rejectionMessage,
      resolution.reason,
    ))
  }
  else {
    return false
  }

  pending.emit({
    ...pending.event,
    auto: false,
    decision: resolution.type,
    reason: resolution.type === 'reject' ? resolution.reason : undefined,
    type: 'hitl.resolved',
  })

  return true
}

export const approveToolCall = (toolCallId: string) =>
  resolvePending(toolCallId, { type: 'approve' })

export const rejectToolCall = (toolCallId: string, reason?: string) =>
  resolvePending(toolCallId, { reason, type: 'reject' })

export const humanInTheLoop = (options: HumanInTheLoopOptions = {}): AgentPlugin => {
  let pluginApi: AgentPluginApi | undefined
  const emit = (event: HITLEvent) => pluginApi?.emit('hitl', event)

  return {
    enforce: 'pre',
    name,
    onTurnStart: ({ sessionId, signal, turnId }) => {
      turnContextBySignal.set(signal, { sessionId, turnId })
    },
    preToolCall: async (toolCall, executeOptions) => {
      const context = executeOptions.abortSignal == null
        ? undefined
        : turnContextBySignal.get(executeOptions.abortSignal)

      if (context == null)
        return toolCall

      const decision = resolveDecision(toolCall, options)
      const eventBase = {
        sessionId: context.sessionId,
        timestamp: Date.now(),
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        turnId: context.turnId,
      }

      if (decision.type === 'approve') {
        emit({
          ...eventBase,
          decision: 'approve',
          type: 'hitl.auto_reviewed',
        })
        emit({
          ...eventBase,
          auto: true,
          decision: 'approve',
          type: 'hitl.resolved',
        })
        return toolCall
      }

      if (decision.type === 'reject') {
        emit({
          ...eventBase,
          decision: 'reject',
          reason: decision.reason,
          type: 'hitl.auto_reviewed',
        })
        emit({
          ...eventBase,
          auto: true,
          decision: 'reject',
          reason: decision.reason,
          type: 'hitl.resolved',
        })
        return buildRejectionResult(toolCall, options.rejectionMessage, decision.reason)
      }

      const key = `${context.turnId}:${toolCall.toolCallId}`
      const deferred = createDeferred<CompletionToolCall | CompletionToolResult>()
      const pending: PendingResolution = {
        deferred,
        emit,
        event: eventBase,
        key,
        rejectionMessage: options.rejectionMessage,
        toolCall,
      }

      pendingByKey.set(key, pending)
      pendingKeyByToolCallId.set(toolCall.toolCallId, key)

      emit({
        ...eventBase,
        args: toolCall.args,
        type: 'hitl.request',
      })

      const onAbort = () => {
        pendingByKey.delete(key)
        pendingKeyByToolCallId.delete(toolCall.toolCallId)
        deferred.reject(executeOptions.abortSignal?.reason ?? new Error('aborted'))
      }

      executeOptions.abortSignal?.addEventListener('abort', onAbort, { once: true })

      try {
        return await deferred.promise
      }
      finally {
        executeOptions.abortSignal?.removeEventListener('abort', onAbort)
        pendingByKey.delete(key)
        pendingKeyByToolCallId.delete(toolCall.toolCallId)
      }
    },
    setup: async (api) => {
      pluginApi = api
    },
    version,
  }
}

export const hitl = humanInTheLoop

export { autoReviewByPattern }
