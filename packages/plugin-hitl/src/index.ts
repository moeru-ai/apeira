import type { ExecutionGrant } from '@apeira/plugin-sandbox'
import type { CompletionToolCall, CompletionToolResult } from '@xsai/shared-chat'

import type {
  HITLAssessment,
  HITLCancellationReason,
  HITLDecision,
  HITLEvent,
  HITLOption,
  HITLOptions,
  HITLPlugin,
  HITLPolicyResult,
  HITLRequest,
  ToolNamePattern,
  ToolPolicyOptions,
} from './types'

import { stableStringify } from '@apeira/internal-utils'

import { name, version } from '../package.json'
import { createReviewerController } from './reviewer'
import { createDeferred } from './utils/deferred'
import { buildRejectionResult } from './utils/message'
import { redactEvent, redactRequest } from './utils/redact'

export type {
  HITLAssessment,
  HITLCancellationReason,
  HITLCancelledEvent,
  HITLDecision,
  HITLEvent,
  HITLOption,
  HITLOptions,
  HITLPlugin,
  HITLPolicy,
  HITLPolicyContext,
  HITLPolicyResult,
  HITLRequest,
  HITLRequestBase,
  HITLRequestEvent,
  HITLResolvedEvent,
  HITLReviewContext,
  HITLReviewer,
  HITLReviewFailedEvent,
  HITLReviewFailure,
  HITLReviewingEvent,
  HITLReviewResult,
  HITLReviewRoute,
  PermissionRequest,
  RejectionMessageFn,
  ToolNamePattern,
  ToolPolicyOptions,
  ToolRequest,
} from './types'

declare module '@apeira/core' {
  interface AgentCustomEvent {
    hitl: HITLEvent
  }
}

interface PendingRequest {
  cacheKey: string
  cancel: (cause?: unknown) => void
  request: HITLRequest
  resolve: (decision: HITLDecision) => void
}

const matches = (name: string, patterns: ToolNamePattern[]) => patterns.some((pattern) => {
  if (pattern instanceof RegExp)
    return new RegExp(pattern.source, pattern.flags).test(name)
  return pattern === name
})

const toolCacheKey = (toolCall: CompletionToolCall) => {
  const fingerprint = stableStringify({
    args: toolCall.args,
    toolName: toolCall.toolName,
  })
  return `tool:${fingerprint}`
}

const optionFor = (decision: HITLDecision): HITLOption => {
  if (decision.type === 'edit')
    return 'edit'
  if (decision.type === 'reject')
    return decision.abortTurn === true ? 'reject_abort' : 'reject'
  return decision.scope === 'session' ? 'approve_session' : 'approve'
}

export const toolPolicy = (options: ToolPolicyOptions): ((request: HITLRequest) => HITLPolicyResult | undefined) =>
  (request) => {
    if (request.type !== 'tool')
      return undefined
    if (matches(request.toolCall.toolName, options.deny ?? []))
      return { reason: options.denyReason, type: 'deny' }
    if (matches(request.toolCall.toolName, options.allow ?? []))
      return { type: 'allow' }
    return undefined
  }

export const hitl = (options: HITLOptions = {}): HITLPlugin => {
  const pending = new Map<string, PendingRequest>()
  let abortTurn: (reason?: unknown) => void = () => {}
  let currentTurnId = ''
  let emit: (event: HITLEvent) => Promise<void> = async () => {}
  let unsubscribeApeira: (() => void) | undefined
  const reviews = createReviewerController({
    emit: async event => emit(event),
    policies: options.policies,
    reviewer: options.reviewer,
  })

  const cancel = (
    requestId: string,
    reason: HITLCancellationReason,
    cause?: unknown,
  ) => {
    const entry = pending.get(requestId)
    if (entry == null)
      return false

    pending.delete(requestId)
    void emit({ reason, request: entry.request, type: 'cancelled' })
    entry.cancel(cause)
    return true
  }

  const resolve: HITLPlugin['resolve'] = (requestId, decision) => {
    const entry = pending.get(requestId)
    if (entry == null || !entry.request.options.includes(optionFor(decision)))
      return false

    pending.delete(requestId)
    if (decision.type === 'approve' && decision.scope === 'session')
      reviews.approveSession(entry.cacheKey)
    entry.resolve(decision)
    void emit({ decision, request: entry.request, source: 'user', type: 'resolved' })
    if (decision.type === 'reject' && decision.abortTurn === true)
      abortTurn(decision.message ?? 'Approval rejected and turn aborted.')
    return true
  }

  const waitForDecision = async <T>(
    request: HITLRequest,
    cacheKey: string,
    apply: (decision: HITLDecision) => T,
    signal?: AbortSignal,
    assessment?: HITLAssessment,
  ): Promise<T> => {
    const deferred = createDeferred<T>()
    const onAbort = () => cancel(request.requestId, 'aborted', signal?.reason)
    const entry: PendingRequest = {
      cacheKey,
      cancel: cause => deferred.reject(cause ?? new Error('Approval cancelled.')),
      request,
      resolve: (decision) => {
        try {
          deferred.resolve(apply(decision))
        }
        catch (error) {
          deferred.reject(error)
        }
      },
    }

    pending.set(request.requestId, entry)
    void emit({ assessment, request, type: 'request' })

    if (signal?.aborted)
      onAbort()
    else
      signal?.addEventListener('abort', onAbort, { once: true })

    return deferred.promise.finally(() => {
      signal?.removeEventListener('abort', onAbort)
      pending.delete(request.requestId)
    })
  }

  const routeApproval = async <T>(options: {
    applyApprove: () => T
    applyEdit?: (args: string) => T
    applyReject: (reason?: string) => T
    cacheKey: string
    request: HITLRequest
    signal?: AbortSignal
  }): Promise<T> => {
    const route = await reviews.route(options.request, options.cacheKey, options.signal)
    if (route.type === 'deny')
      return options.applyReject(route.reason)
    if (route.type === 'approve')
      return options.applyApprove()

    return waitForDecision(
      options.request,
      options.cacheKey,
      (decision) => {
        if (decision.type === 'approve')
          return options.applyApprove()
        if (decision.type === 'edit' && options.applyEdit != null)
          return options.applyEdit(decision.args)
        return options.applyReject(decision.type === 'reject' ? decision.message : undefined)
      },
      options.signal,
      route.assessment,
    )
  }

  const authorizeEscalation: HITLPlugin['authorizeEscalation'] = async (execution, context) => {
    if (currentTurnId.length === 0)
      return undefined

    const request: HITLRequest = {
      command: execution.command,
      createdAt: Date.now(),
      cwd: execution.cwd,
      defaultProfile: context.defaultProfile,
      escalation: execution.escalation,
      executionRequestId: context.requestId,
      options: ['approve', 'approve_session', 'reject', 'reject_abort'],
      requestId: crypto.randomUUID(),
      turnId: currentTurnId,
      type: 'permission',
    }
    const permissionKey = stableStringify({
      command: execution.escalation.type === 'bypass' ? execution.command : undefined,
      cwd: execution.cwd,
      escalation: execution.escalation,
    })
    const cacheKey = `permission:${permissionKey}`
    return routeApproval<ExecutionGrant | undefined>({
      applyApprove: () => context.createGrant(),
      applyReject: () => undefined,
      cacheKey,
      request,
      signal: context.signal,
    })
  }

  const finishTurn = (turnId: string) => {
    currentTurnId = ''
    reviews.finishTurn(turnId)
    for (const entry of pending.values()) {
      if (entry.request.turnId === turnId)
        cancel(entry.request.requestId, 'turn_finished')
    }
  }

  return {
    authorizeEscalation,
    enforce: 'pre',
    init: (agent) => {
      abortTurn = agent.abort
      emit = async event => agent.emit('hitl', redactEvent(event))
      reviews.init(agent)
      unsubscribeApeira = agent.subscribe('apeira', (event) => {
        if (event.type === 'turn.start') {
          currentTurnId = event.turnId
          reviews.startTurn(event.turnId)
        }
        else if (
          ['turn.aborted', 'turn.done', 'turn.failed'].includes(event.type)
          && currentTurnId === event.turnId
        ) {
          finishTurn(event.turnId)
        }
      })
    },
    listPending: listOptions => Array.from(
      pending.values(),
      entry => entry.request,
    )
      .filter(request => listOptions?.turnId == null || request.turnId === listOptions.turnId)
      .map(redactRequest),
    name,
    prepareStep: (step) => {
      reviews.captureInput(step.input)
      return {}
    },
    preToolCall: async (toolCall, executeOptions) => {
      if (currentTurnId.length === 0) {
        return buildRejectionResult(
          toolCall,
          options.rejectionMessage,
          'Tool execution blocked: missing or untracked execution context.',
        )
      }

      const request: HITLRequest = {
        createdAt: Date.now(),
        options: ['approve', 'approve_session', 'edit', 'reject', 'reject_abort'],
        requestId: crypto.randomUUID(),
        toolCall,
        turnId: currentTurnId,
        type: 'tool',
      }
      const cacheKey = toolCacheKey(toolCall)
      return routeApproval<CompletionToolCall | CompletionToolResult>({
        applyApprove: () => toolCall,
        applyEdit: args => ({ ...toolCall, args }),
        applyReject: reason => buildRejectionResult(toolCall, options.rejectionMessage, reason),
        cacheKey,
        request,
        signal: executeOptions.abortSignal,
      })
    },
    resolve,
    get reviewer() {
      return reviews.reviewer
    },
    setReviewer: (reviewer) => {
      reviews.setReviewer(reviewer)
    },
    stop: () => {
      reviews.stop()
      for (const entry of pending.values())
        cancel(entry.request.requestId, 'stopped')
      currentTurnId = ''
      unsubscribeApeira?.()
      unsubscribeApeira = undefined
    },
    version,
  }
}
