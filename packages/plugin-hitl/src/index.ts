import type { ExecutionGrant } from '@apeira/plugin-sandbox'
import type { CompletionToolCall, CompletionToolResult } from '@xsai/shared-chat'

import type {
  HITLCancellationReason,
  HITLDecision,
  HITLEvent,
  HITLOption,
  HITLOptions,
  HITLPlugin,
  HITLPolicyResult,
  HITLRequest,
  HITLResolvedEvent,
  ToolNamePattern,
  ToolPolicyOptions,
} from './types'

import { name, version } from '../package.json'
import { createDeferred } from './utils/deferred'
import { buildRejectionResult } from './utils/message'

export type {
  HITLCancellationReason,
  HITLCancelledEvent,
  HITLDecision,
  HITLEvent,
  HITLOption,
  HITLOptions,
  HITLPlugin,
  HITLPolicy,
  HITLPolicyResult,
  HITLRequest,
  HITLRequestBase,
  HITLRequestEvent,
  HITLResolvedEvent,
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

const matches = (name: string, patterns: ToolNamePattern[]) =>
  patterns.some(pattern => pattern instanceof RegExp ? pattern.test(name) : pattern === name)

const stable = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map(stable).join(',')}]`
  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')
    return `{${entries}}`
  }
  return JSON.stringify(value)
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
  const sessionApprovals = new Set<string>()
  let abortTurn: (reason?: unknown) => void = () => {}
  let currentTurnId = ''
  let emit: (event: HITLEvent) => void = () => {}
  let unsubscribeApeira: (() => void) | undefined

  const emitResolved = (
    request: HITLRequest,
    decision: HITLDecision,
    source: HITLResolvedEvent['source'],
  ) => emit({ decision, request, source, type: 'resolved' })

  const cancel = (
    requestId: string,
    reason: HITLCancellationReason,
    cause?: unknown,
  ) => {
    const entry = pending.get(requestId)
    if (entry == null)
      return false

    pending.delete(requestId)
    emit({ reason, request: entry.request, type: 'cancelled' })
    entry.cancel(cause)
    return true
  }

  const resolve: HITLPlugin['resolve'] = (requestId, decision) => {
    const entry = pending.get(requestId)
    if (entry == null || !entry.request.options.includes(optionFor(decision)))
      return false

    pending.delete(requestId)
    if (decision.type === 'approve' && decision.scope === 'session')
      sessionApprovals.add(entry.cacheKey)
    entry.resolve(decision)
    emitResolved(entry.request, decision, 'user')
    if (decision.type === 'reject' && decision.abortTurn === true)
      abortTurn(decision.message ?? 'Approval rejected and turn aborted.')
    return true
  }

  const review = async (request: HITLRequest): Promise<HITLPolicyResult> => {
    if (options.policies == null || options.policies.length === 0)
      return { type: 'ask' }

    const results = await Promise.all(options.policies.map(async (policy): Promise<HITLPolicyResult | undefined> => {
      try {
        return await policy(request)
      }
      catch {
        return { type: 'ask' }
      }
    }))
    const reviews = results.filter((result): result is HITLPolicyResult => result != null)

    return reviews.find(result => result.type === 'deny')
      ?? reviews.find(result => result.type === 'ask')
      ?? reviews.find(result => result.type === 'allow')
      ?? { type: 'ask' }
  }

  const waitForDecision = async <T>(
    request: HITLRequest,
    cacheKey: string,
    apply: (decision: HITLDecision) => T,
    signal?: AbortSignal,
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
    emit({ request, type: 'request' })

    if (signal?.aborted)
      onAbort()
    else
      signal?.addEventListener('abort', onAbort, { once: true })

    return deferred.promise.finally(() => {
      signal?.removeEventListener('abort', onAbort)
      pending.delete(request.requestId)
    })
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
    const permissionKey = stable({
      command: execution.escalation.type === 'bypass' ? execution.command : undefined,
      cwd: execution.cwd,
      escalation: execution.escalation,
    })
    const cacheKey = `permission:${permissionKey}`
    const result = options.policies == null || options.policies.length === 0
      ? { type: 'ask' } as const
      : await review(request)

    if (context.signal?.aborted)
      throw context.signal.reason ?? new Error('Approval aborted.')
    if (currentTurnId !== request.turnId)
      return undefined
    if (result.type === 'deny') {
      emitResolved(request, { message: result.reason, type: 'reject' }, 'policy')
      return undefined
    }
    if (result.type === 'allow') {
      emitResolved(request, { type: 'approve' }, 'policy')
      return context.createGrant()
    }
    if (sessionApprovals.has(cacheKey)) {
      emitResolved(request, { scope: 'session', type: 'approve' }, 'session')
      return context.createGrant()
    }

    return waitForDecision<ExecutionGrant | undefined>(
      request,
      cacheKey,
      decision => decision.type === 'approve' ? context.createGrant() : undefined,
      context.signal,
    )
  }

  const finishTurn = (turnId: string) => {
    currentTurnId = ''
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
      // eslint-disable-next-line ts/no-misused-promises
      emit = async event => agent.emit('hitl', event)
      unsubscribeApeira = agent.subscribe('apeira', (event) => {
        if (event.type === 'turn.start') {
          currentTurnId = event.turnId
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
    ).filter(request => listOptions?.turnId == null || request.turnId === listOptions.turnId),
    name,
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
      const cacheKey = `tool:${toolCall.toolName}`
      const result = options.policies == null || options.policies.length === 0
        ? { type: 'ask' } as const
        : await review(request)

      if (currentTurnId !== request.turnId) {
        return buildRejectionResult(
          toolCall,
          options.rejectionMessage,
          'Turn ended before approval.',
        )
      }
      if (result.type === 'deny') {
        emitResolved(request, { message: result.reason, type: 'reject' }, 'policy')
        return buildRejectionResult(toolCall, options.rejectionMessage, result.reason)
      }
      if (result.type === 'allow') {
        emitResolved(request, { type: 'approve' }, 'policy')
        return toolCall
      }
      if (sessionApprovals.has(cacheKey)) {
        emitResolved(request, { scope: 'session', type: 'approve' }, 'session')
        return toolCall
      }

      return waitForDecision<CompletionToolCall | CompletionToolResult>(
        request,
        cacheKey,
        (decision) => {
          if (decision.type === 'approve')
            return toolCall
          if (decision.type === 'edit')
            return { ...toolCall, args: decision.args }
          return buildRejectionResult(toolCall, options.rejectionMessage, decision.message)
        },
        executeOptions.abortSignal,
      )
    },
    resolve,
    stop: () => {
      for (const entry of pending.values())
        cancel(entry.request.requestId, 'stopped')
      sessionApprovals.clear()
      unsubscribeApeira?.()
      unsubscribeApeira = undefined
    },
    version,
  }
}
