import type { AgentPlugin, PluginPrivateStateApi, PluginToolExecuteOptions, ToolInterruption } from '@apeira/core'
import type { CompletionToolCall, CompletionToolResult, Tool } from '@xsai/shared-chat'

import { name, version } from '../package.json'

export interface HITLController {
  approve: (id: string, scope?: HITLScope) => boolean
  clear: () => void
  getDecisionForResume: (id: string) => HITLResumeDecision | undefined
  pending: () => HITLPendingRequest[]
  plugin: AgentPlugin
  reject: (id: string, message?: string) => boolean
  setMode: (mode: HITLMode) => void
}

export interface HITLMetadata {
  risk?: 'high' | 'low' | 'medium'
  source?: string
  targets?: string[]
}

export type HITLMode = 'allow' | 'ask' | 'deny' | 'off'

export interface HITLPendingRequest {
  id: string
  key: string
  metadata?: HITLMetadata
  reason?: string
  toolCall: CompletionToolCall
  toolName: string
}

export interface HITLPluginOptions {
  mode?: HITLMode
  policy?: (context: HITLPolicyContext) => HITLPolicyDecision | Promise<HITLPolicyDecision>
  scope?: HITLScope
}

export interface HITLPolicyContext extends PluginToolExecuteOptions {
  key: string
  metadata?: HITLMetadata
  toolCall: CompletionToolCall
}

export type HITLPolicyDecision
  = | { message?: string, type: 'ask' }
    | { message?: string, type: 'deny' }
    | { type: 'allow' }

export interface HITLPrivateState {
  conversationAllows?: Record<string, true>
}

export type HITLResumeDecision
  = | { id: string, key: string, message: string, type: 'rejected' }
    | { id: string, scope: HITLScope, type: 'approved' }

export type HITLScope = 'call' | 'conversation' | 'run'

interface PendingResolver {
  resolve: (result: CompletionToolResult | void) => void
}

const metadata = new WeakMap<Tool, HITLMetadata>()

export const withHitlMetadata = <T extends Tool>(tool: T, value: HITLMetadata): T => {
  metadata.set(tool, value)
  return tool
}

const getToolKey = (toolCall: CompletionToolCall) =>
  JSON.stringify([
    toolCall.toolName,
    toolCall.args,
  ])

const getPrivateState = (state: PluginPrivateStateApi<HITLPrivateState>): HITLPrivateState =>
  state.get() ?? {}

const hasConversationAllow = (state: PluginPrivateStateApi<HITLPrivateState>, key: string) =>
  getPrivateState(state).conversationAllows?.[key] === true

const setConversationAllow = (state: PluginPrivateStateApi<HITLPrivateState>, key: string) => {
  state.update(value => ({
    ...value,
    conversationAllows: {
      ...(value?.conversationAllows ?? {}),
      [key]: true,
    },
  }))
}

const parseArgs = (args: string): Record<string, unknown> => {
  try {
    return JSON.parse(args.trim() || '{}') as Record<string, unknown>
  }
  catch {
    return {}
  }
}

const createRejectedResult = (toolCall: CompletionToolCall, message = 'TOOL_HITL_REJECTED'): CompletionToolResult => ({
  args: parseArgs(toolCall.args),
  result: message,
  toolCallId: toolCall.toolCallId,
  toolName: toolCall.toolName,
})

export const hitl = (options: HITLPluginOptions = {}): HITLController => {
  let mode: HITLMode = options.mode ?? 'ask'

  const pending = new Map<string, HITLPendingRequest>()
  const pendingResolvers = new Map<string, PendingResolver>()
  const pendingState = new Map<string, PluginPrivateStateApi<HITLPrivateState>>()
  const resumeDecisions = new Map<string, HITLResumeDecision>()
  const runAllows = new Set<string>()

  const resolveDecision = async (context: HITLPolicyContext): Promise<HITLPolicyDecision> => {
    if (mode === 'off' || mode === 'allow')
      return { type: 'allow' }
    if (mode === 'deny')
      return { type: 'deny' }

    return await options.policy?.(context) ?? { type: 'ask' }
  }

  const waitForDecision = async (request: HITLPendingRequest) =>
    new Promise<CompletionToolResult | void>((resolve) => {
      pendingResolvers.set(request.id, { resolve })
    })

  const preToolCall: NonNullable<AgentPlugin['preToolCall']> = async (toolCall, context) => {
    const privateState = context.privateState as PluginPrivateStateApi<HITLPrivateState> | undefined
    if (privateState == null)
      throw new Error('@apeira/plugin-hitl requires plugin private state support from @apeira/core.')

    const key = getToolKey(toolCall)

    if (mode === 'deny')
      return createRejectedResult(toolCall)

    if (runAllows.has(key) || hasConversationAllow(privateState, key))
      return

    const tool = context.tools?.find(tool => tool.function.name === toolCall.toolName)
    const toolMetadata = tool == null ? undefined : metadata.get(tool)
    const decision = await resolveDecision({
      ...context,
      key,
      metadata: toolMetadata,
      toolCall,
    })

    if (decision.type === 'allow')
      return

    if (decision.type === 'deny')
      return createRejectedResult(toolCall, decision.message)

    const interruption: ToolInterruption = {
      data: {
        key,
        metadata: toolMetadata,
      },
      id: `hitl_${toolCall.toolCallId}`,
      reason: decision.message ?? 'Human review required.',
      toolCall,
    }
    const request: HITLPendingRequest = {
      id: interruption.id,
      key,
      metadata: toolMetadata,
      reason: interruption.reason,
      toolCall,
      toolName: toolCall.toolName,
    }

    pending.set(interruption.id, request)
    pendingState.set(interruption.id, privateState)
    context.emit?.({
      interruption,
      type: 'tool-interruption',
    })

    return waitForDecision(request)
  }

  const approve: HITLController['approve'] = (id, scope = options.scope ?? 'call') => {
    const request = pending.get(id)
    if (request == null)
      return false

    if (scope === 'run') {
      runAllows.add(request.key)
    }
    else if (scope === 'conversation') {
      const state = pendingState.get(id)
      if (state == null)
        return false

      setConversationAllow(state, request.key)
    }

    resumeDecisions.set(id, { id, scope, type: 'approved' })
    pending.delete(id)
    pendingState.delete(id)
    pendingResolvers.get(id)?.resolve()
    pendingResolvers.delete(id)
    return true
  }

  const reject: HITLController['reject'] = (id, message = 'TOOL_HITL_REJECTED') => {
    const request = pending.get(id)
    if (request == null)
      return false

    resumeDecisions.set(id, {
      id,
      key: request.key,
      message,
      type: 'rejected',
    })
    pending.delete(id)
    pendingState.delete(id)
    pendingResolvers.get(id)?.resolve(createRejectedResult(request.toolCall, message))
    pendingResolvers.delete(id)
    return true
  }

  return {
    approve,
    clear: () => {
      for (const [id, resolver] of pendingResolvers) {
        const request = pending.get(id)
        resolver.resolve(request == null
          ? undefined
          : createRejectedResult(request.toolCall, 'TOOL_HITL_REJECTED: HITL state cleared'))
      }
      pending.clear()
      pendingState.clear()
      pendingResolvers.clear()
      resumeDecisions.clear()
      runAllows.clear()
    },
    getDecisionForResume: id => resumeDecisions.get(id),
    pending: () => [...pending.values()],
    plugin: {
      name,
      onTurnDone: () => {
        runAllows.clear()
      },
      preToolCall,
      version,
    },
    reject,
    setMode: nextMode => mode = nextMode,
  }
}
