import type { AgentPlugin } from '@apeira/core'
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
  ToolNamePattern,
  ToolPolicy,
} from './types'

declare module '@apeira/core' {
  interface AgentCustomEvent {
    hitl: HITLEvent
  }
}

interface PendingResolution {
  deferred: ReturnType<typeof createDeferred<CompletionToolCall | CompletionToolResult>>
  event: {
    timestamp: number
    toolCallId: string
    toolName: string
    turnId: string
  }
  key: string
  rejectionMessage: HumanInTheLoopOptions['rejectionMessage']
  toolCall: CompletionToolCall
}

type ResolvePending = (toolCallId: string, resolution: ApprovalDecision) => boolean

const pendingResolverByToolCallId = new Map<string, ResolvePending>()
const resolvePending = (toolCallId: string, resolution: ApprovalDecision) => {
  return pendingResolverByToolCallId.get(toolCallId)?.(toolCallId, resolution) ?? false
}

export const approveToolCall = (toolCallId: string) =>
  resolvePending(toolCallId, { type: 'approve' })

export const rejectToolCall = (toolCallId: string, reason?: string) =>
  resolvePending(toolCallId, { reason, type: 'reject' })

export const humanInTheLoop = (options: HumanInTheLoopOptions = {}): AgentPlugin => {
  const pendingByKey = new Map<string, PendingResolution>()
  const pendingKeyByToolCallId = new Map<string, string>()
  let currentTurnId = ''
  let emit: (event: HITLEvent) => void = () => {}
  let unsubscribe: (() => void) | undefined

  const removePending = (toolCallId: string, key?: string) => {
    const resolvedKey = key ?? pendingKeyByToolCallId.get(toolCallId)

    pendingResolverByToolCallId.delete(toolCallId)
    pendingKeyByToolCallId.delete(toolCallId)

    if (resolvedKey != null)
      pendingByKey.delete(resolvedKey)
  }

  const resolvePendingForPlugin: ResolvePending = (toolCallId, resolution) => {
    const key = pendingKeyByToolCallId.get(toolCallId)
    const pending = key == null ? undefined : pendingByKey.get(key)

    if (pending == null)
      return false

    removePending(toolCallId, key)

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

    emit({
      ...pending.event,
      auto: false,
      decision: resolution.type,
      reason: resolution.type === 'reject' ? resolution.reason : undefined,
      type: 'hitl.resolved',
    })

    return true
  }

  return {
    enforce: 'pre',
    init: (agent) => {
      emit = event => agent.emit('hitl', event)
      unsubscribe = agent.subscribe('apeira', (event) => {
        if (event.type === 'turn.start') {
          currentTurnId = event.turnId
        }
        else if (['turn.aborted', 'turn.done', 'turn.failed'].includes(event.type)) {
          if (currentTurnId === event.turnId)
            currentTurnId = ''
        }
      })
    },
    name,
    preToolCall: async (toolCall, executeOptions) => {
      const turnId = currentTurnId
      const decision = resolveDecision(toolCall, options)

      if (turnId.length === 0) {
        if (decision.type === 'approve')
          return toolCall

        return buildRejectionResult(
          toolCall,
          options.rejectionMessage,
          'Tool execution blocked: missing or untracked execution context.',
        )
      }

      const eventBase = {
        timestamp: Date.now(),
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        turnId,
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

      const key = `${turnId}:${toolCall.toolCallId}`
      const deferred = createDeferred<CompletionToolCall | CompletionToolResult>()
      const pending: PendingResolution = {
        deferred,
        event: eventBase,
        key,
        rejectionMessage: options.rejectionMessage,
        toolCall,
      }

      pendingByKey.set(key, pending)
      pendingKeyByToolCallId.set(toolCall.toolCallId, key)
      pendingResolverByToolCallId.set(toolCall.toolCallId, resolvePendingForPlugin)

      emit({
        ...eventBase,
        args: toolCall.args,
        type: 'hitl.request',
      })

      const onAbort = () => {
        removePending(toolCall.toolCallId, key)
        deferred.reject(executeOptions.abortSignal?.reason ?? new Error('aborted'))
      }

      if (executeOptions.abortSignal?.aborted) {
        onAbort()
      }
      else {
        executeOptions.abortSignal?.addEventListener('abort', onAbort, { once: true })
      }

      try {
        return await deferred.promise
      }
      finally {
        executeOptions.abortSignal?.removeEventListener('abort', onAbort)
        removePending(toolCall.toolCallId, key)
      }
    },
    stop: () => {
      unsubscribe?.()
      unsubscribe = undefined
    },
    version,
  }
}

export const hitl = humanInTheLoop

export { autoReviewByPattern }
