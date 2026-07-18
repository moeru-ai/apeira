import type { Agent, AgentInput } from '@apeira/core'

import type {
  HITLAssessment,
  HITLCancellationReason,
  HITLEvent,
  HITLOptions,
  HITLPolicyResult,
  HITLRequest,
  HITLReviewer,
  HITLReviewFailure,
} from './types'

import { raceAbort } from '@apeira/internal-utils'

export interface ReviewerController {
  approveSession: (key: string) => void
  captureInput: (input: readonly AgentInput[]) => void
  finishTurn: (turnId: string) => void
  init: (agent: Agent) => void
  readonly reviewer: 'user' | HITLReviewer
  route: (request: HITLRequest, cacheKey: string, signal?: AbortSignal) => Promise<ReviewRoute>
  setReviewer: (reviewer: 'user' | HITLReviewer) => void
  startTurn: (turnId: string) => void
  stop: () => void
}

export type ReviewRoute
  = | { assessment?: HITLAssessment, type: 'ask' }
    | { reason?: string, type: 'deny' }
    | { type: 'approve' }

interface ReviewCancellation {
  cause?: unknown
  type: HITLCancellationReason
}

interface ReviewerControllerOptions {
  emit: (event: HITLEvent) => Promise<void>
  policies: HITLOptions['policies']
  reviewer?: HITLReviewer
}

const reviewPolicies = async (
  policies: HITLOptions['policies'],
  request: HITLRequest,
  signal: AbortSignal,
): Promise<HITLPolicyResult> => {
  if (policies == null || policies.length === 0)
    return { type: 'ask' }

  const reviews = Promise.all(policies.map(async (policy): Promise<HITLPolicyResult | undefined> => {
    try {
      return await policy(request, { signal })
    }
    catch (error) {
      if (signal.aborted)
        throw signal.reason ?? error
      return { type: 'ask' }
    }
  }))
  const results = await raceAbort(reviews, signal)
  const policyResults = results.filter((result): result is HITLPolicyResult => result != null)
  return policyResults.find(result => result.type === 'deny')
    ?? policyResults.find(result => result.type === 'ask')
    ?? policyResults.find(result => result.type === 'allow')
    ?? { type: 'ask' }
}

const reviewerFailure = (error: unknown) => ({
  failure: {
    message: error instanceof Error ? error.message : undefined,
    type: 'reviewer_error' as const,
  },
  type: 'failure' as const,
})

const cancellationFrom = (
  signal: AbortSignal,
  external?: AbortSignal,
): ReviewCancellation => {
  if (external?.aborted)
    return { cause: external.reason, type: 'aborted' }
  const reason: unknown = signal.reason
  if (reason != null && typeof reason === 'object' && 'type' in reason) {
    const cancellation = reason as Partial<ReviewCancellation>
    if (['stopped', 'turn_finished'].includes(cancellation.type ?? ''))
      return { cause: cancellation.cause, type: cancellation.type as HITLCancellationReason }
  }
  return { cause: reason, type: 'aborted' }
}

export const createReviewerController = (
  options: ReviewerControllerOptions,
): ReviewerController => {
  const sessions = new Set<string>()
  let currentInput: readonly AgentInput[] = []
  let currentReviewer: 'user' | HITLReviewer = options.reviewer ?? 'user'
  let currentTurnId = ''
  let runner: Agent['runner'] | undefined
  let turnController = new AbortController()

  const isRequestInCurrentTurn = (request: HITLRequest) => currentTurnId === request.turnId

  const emitResolved = async (
    request: HITLRequest,
    source: 'policy' | 'reviewer' | 'reviewer_failure' | 'session',
    detail: {
      assessment?: HITLAssessment
      failure?: HITLReviewFailure
      message?: string
      type: 'approve' | 'reject'
    },
  ) => options.emit({
    assessment: detail.assessment,
    decision: detail.type === 'approve'
      ? { type: 'approve' }
      : { message: detail.message, type: 'reject' },
    failure: detail.failure,
    request,
    source,
    type: 'resolved',
  })

  const runReviewer = async (
    reviewer: HITLReviewer,
    request: HITLRequest,
    external?: AbortSignal,
  ) => {
    if (runner == null)
      return reviewerFailure(new Error('HITL plugin is not initialized.'))

    const signal = external == null
      ? turnController.signal
      : AbortSignal.any([turnController.signal, external])
    await options.emit({ request, reviewer: reviewer.name, type: 'reviewing' })

    try {
      const result = await reviewer.review(request, { input: currentInput, runner, signal })
      if (signal.aborted)
        throw signal.reason
      return result
    }
    catch (error) {
      if (!signal.aborted)
        return reviewerFailure(error)
      const cancellation = cancellationFrom(signal, external)
      await options.emit({ reason: cancellation.type, request, type: 'cancelled' })
      throw cancellation.cause ?? error
    }
  }

  const routePolicy = async (
    request: HITLRequest,
    cacheKey: string,
    policy: HITLPolicyResult,
  ): Promise<ReviewRoute | undefined> => {
    switch (policy.type) {
      case 'allow':
        await emitResolved(request, 'policy', { type: 'approve' })
        return { type: 'approve' }
      case 'ask':
        if (!sessions.has(cacheKey))
          return undefined
        await options.emit({
          decision: { scope: 'session', type: 'approve' },
          request,
          source: 'session',
          type: 'resolved',
        })
        return { type: 'approve' }
      case 'deny':
        await emitResolved(request, 'policy', { message: policy.reason, type: 'reject' })
        return { reason: policy.reason, type: 'deny' }
    }
  }

  const routeFailure = async (
    request: HITLRequest,
    reviewer: HITLReviewer,
    failure: HITLReviewFailure,
  ): Promise<ReviewRoute> => {
    await options.emit({ failure, request, reviewer: reviewer.name, type: 'review_failed' })
    if ((reviewer.onFailure ?? 'ask') === 'ask')
      return { type: 'ask' }

    const reason = failure.message ?? 'Automatic approval review failed.'
    await emitResolved(request, 'reviewer_failure', {
      failure,
      message: reason,
      type: 'reject',
    })
    return { reason, type: 'deny' }
  }

  const routeAssessment = async (
    request: HITLRequest,
    reviewer: HITLReviewer,
    assessment: HITLAssessment,
  ): Promise<ReviewRoute> => {
    if (assessment.userAuthorization === 'unknown' || assessment.riskLevel === 'high')
      return { assessment, type: 'ask' }

    if (assessment.riskLevel === 'critical' && assessment.type === 'approve') {
      await emitResolved(request, 'reviewer', {
        assessment,
        message: 'Critical-risk actions cannot be automatically approved.',
        type: 'reject',
      })
      return { reason: 'Critical-risk actions cannot be automatically approved.', type: 'deny' }
    }
    if (assessment.type === 'approve') {
      await emitResolved(request, 'reviewer', { assessment, type: 'approve' })
      return { type: 'approve' }
    }
    if ((reviewer.onDeny ?? 'deny') === 'ask')
      return { assessment, type: 'ask' }

    await emitResolved(request, 'reviewer', {
      assessment,
      message: assessment.rationale,
      type: 'reject',
    })
    return { reason: assessment.rationale, type: 'deny' }
  }

  const routeReviewer = async (
    request: HITLRequest,
    signal?: AbortSignal,
  ): Promise<ReviewRoute> => {
    const reviewer = currentReviewer
    if (reviewer === 'user')
      return { type: 'ask' }

    const result = await runReviewer(reviewer, request, signal)
    if (!isRequestInCurrentTurn(request))
      return { reason: 'Turn ended before approval.', type: 'deny' }
    return result.type === 'failure'
      ? routeFailure(request, reviewer, result.failure)
      : routeAssessment(request, reviewer, result)
  }

  const route = async (
    request: HITLRequest,
    cacheKey: string,
    signal?: AbortSignal,
  ): Promise<ReviewRoute> => {
    const reviewSignal = signal == null
      ? turnController.signal
      : AbortSignal.any([turnController.signal, signal])
    const policy = await reviewPolicies(options.policies, request, reviewSignal)
    reviewSignal.throwIfAborted()
    if (!isRequestInCurrentTurn(request))
      return { reason: 'Turn ended before approval.', type: 'deny' }
    const policyRoute = await routePolicy(request, cacheKey, policy)
    return policyRoute ?? routeReviewer(request, reviewSignal)
  }

  const abortTurn = (type: 'stopped' | 'turn_finished') => {
    if (turnController.signal.aborted)
      return
    turnController.abort({ type } satisfies ReviewCancellation)
  }

  return {
    approveSession: key => sessions.add(key),
    captureInput: (input) => {
      currentInput = [...input]
    },
    finishTurn: (turnId) => {
      if (currentTurnId !== turnId)
        return
      abortTurn('turn_finished')
      currentInput = []
      currentTurnId = ''
    },
    init: (agent) => {
      runner = agent.runner
    },
    get reviewer() {
      return currentReviewer
    },
    route,
    setReviewer: (reviewer) => {
      currentReviewer = reviewer
    },
    startTurn: (turnId) => {
      abortTurn('turn_finished')
      currentInput = []
      currentTurnId = turnId
      turnController = new AbortController()
    },
    stop: () => {
      abortTurn('stopped')
      currentInput = []
      currentTurnId = ''
      runner = undefined
      sessions.clear()
    },
  }
}
