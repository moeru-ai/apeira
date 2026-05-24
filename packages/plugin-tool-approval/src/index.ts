import type {
  AgentContext,
  AgentPlugin,
  MaybePromise,
  PluginPrivateStateApi,
  PreToolCallOptions,
} from '@apeira/core'

import { name, version } from '../package.json'

export type ToolApprovalAllowScope = 'conversation' | 'once' | 'turn'

export interface ToolApprovalClassification {
  risk?: ToolApprovalRisk
  source?: string
  targets?: ToolApprovalTarget[]
}

export interface ToolApprovalClassificationInput<TContext = unknown> {
  context: AgentContext<TContext>
  hints: ToolApprovalHints
  input: unknown
  tool: Tool
  toolName: string
}

export type ToolApprovalDecision
  = | { message?: string, type: 'ask' }
    | { message?: string, type: 'deny' }
    | { scope?: ToolApprovalAllowScope, type: 'allow' }

export interface ToolApprovalDecisionEvent<TContext = unknown> {
  decision: ToolApprovalDecision
  request: ToolApprovalRequest<TContext>
  source: 'context_history' | 'policy' | 'turn_cache'
}

export interface ToolApprovalHints {
  risk?: ToolApprovalRisk
  source?: string
  targets?: ToolApprovalTarget[]
}

export interface ToolApprovalHintsInput<TContext = unknown> {
  context: AgentContext<TContext>
  input: unknown
  tool: Tool
  toolName: string
}

export type ToolApprovalHintsResolver<TContext = unknown> = (
  input: ToolApprovalHintsInput<TContext>,
) => MaybePromise<ToolApprovalHints | void>

export interface ToolApprovalHistoryEntry {
  createdAt: number
  decision: 'allow'
  key: string
  requestSummary: string
  scope: 'conversation'
}

export interface ToolApprovalHistoryFilter {
  scope?: 'conversation'
}

export type ToolApprovalMode = 'allow' | 'ask' | 'deny' | 'off'

export interface ToolApprovalOptions<TContext = unknown> {
  classify?: (input: ToolApprovalClassificationInput<TContext>) => MaybePromise<ToolApprovalClassification | void>
  missingPolicy?: 'allow' | 'deny'
  mode?: ToolApprovalMode
  onDecision?: (event: ToolApprovalDecisionEvent<TContext>) => MaybePromise<void>
  policy?: (request: ToolApprovalRequest<TContext>) => MaybePromise<ToolApprovalDecision>
}

export type ToolApprovalPlugin<TContext = unknown> = AgentPlugin<TContext> & {
  clearHistory: (filter?: ToolApprovalHistoryFilter) => void
  setMode: (mode: ToolApprovalMode) => void
  setPolicy: (policy: ToolApprovalOptions<TContext>['policy']) => void
}

export interface ToolApprovalPrivateState {
  allowed: Record<string, ToolApprovalHistoryEntry>
  version: 1
}

export interface ToolApprovalRequest<TContext = unknown> {
  agentName: string
  context: AgentContext<TContext>
  hints: ToolApprovalHints
  input: unknown
  risk: ToolApprovalRisk
  sessionId: string
  signal: AbortSignal
  source?: string
  targets: ToolApprovalTarget[]
  tool: Tool
  toolName: string
  turnId: string
}

export type ToolApprovalRisk = 'execute' | 'external' | 'network' | 'read' | 'unknown' | 'write'

export interface ToolApprovalRule {
  decision: ToolApprovalDecision
  risk?: ToolApprovalRisk
  source?: string
  toolName?: string
}

export interface ToolApprovalTarget {
  operation?: string
  type: 'command' | 'custom' | 'host' | 'path' | 'url'
  value: string
}

type Tool = PreToolCallOptions['tool']

const TOOL_APPROVAL_HINTS = Symbol.for('@apeira/plugin-tool-approval.hints')

type ToolWithApprovalHints<TContext = unknown> = Tool & {
  [TOOL_APPROVAL_HINTS]?: Array<ToolApprovalHintsResolver<TContext>>
}

const normalizeHintsResolvers = <TContext>(
  resolvers: Array<ToolApprovalHintsResolver<TContext>> | ToolApprovalHintsResolver<TContext>,
) => Array.isArray(resolvers) ? resolvers : [resolvers]

const getToolApprovalHintsResolvers = <TContext>(
  tool: Tool,
): Array<ToolApprovalHintsResolver<TContext>> =>
  (tool as ToolWithApprovalHints<TContext>)[TOOL_APPROVAL_HINTS] ?? []

const withToolApprovalHintsResolvers = <TContext>(
  tool: Tool,
  resolvers: Array<ToolApprovalHintsResolver<TContext>>,
): Tool => ({
  ...tool,
  [TOOL_APPROVAL_HINTS]: [
    ...getToolApprovalHintsResolvers<TContext>(tool),
    ...resolvers,
  ],
} as ToolWithApprovalHints<TContext>)

const mergeToolApprovalHints = (
  current: ToolApprovalHints,
  next: ToolApprovalHints | void,
): ToolApprovalHints => {
  if (next == null)
    return current

  return {
    risk: next.risk ?? current.risk,
    source: next.source ?? current.source,
    targets: [
      ...(current.targets ?? []),
      ...(next.targets ?? []),
    ],
  }
}

const resolveToolApprovalHints = async <TContext>(
  input: ToolApprovalHintsInput<TContext>,
): Promise<ToolApprovalHints> => {
  let hints: ToolApprovalHints = {}

  for (const resolver of getToolApprovalHintsResolvers<TContext>(input.tool))
    hints = mergeToolApprovalHints(hints, await resolver(input))

  return hints
}

const createInitialState = (): ToolApprovalPrivateState => ({
  allowed: {},
  version: 1,
})

const getPrivateState = (privateState?: PluginPrivateStateApi): ToolApprovalPrivateState => {
  const state = privateState?.get<ToolApprovalPrivateState>()
  if (state?.version === 1 && state.allowed != null)
    return state

  return createInitialState()
}

const setPrivateState = (
  privateState: PluginPrivateStateApi | undefined,
  state: ToolApprovalPrivateState,
) => {
  privateState?.set(state)
}

const stableStringify = (value: unknown): string => {
  if (value == null || typeof value !== 'object')
    return JSON.stringify(value)

  if (Array.isArray(value))
    return `[${value.map(item => stableStringify(item)).join(',')}]`

  const serializedEntries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => {
      const serialized = stableStringify(item)
      return `${JSON.stringify(key)}:${serialized}`
    })
    .join(',')

  return `{${serializedEntries}}`
}

const createApprovalKey = (request: ToolApprovalRequest) =>
  stableStringify({
    input: request.input,
    risk: request.risk,
    source: request.source,
    targets: request.targets,
    toolName: request.toolName,
  })

const createDeniedOutput = (message?: string) => ({
  error: {
    code: 'TOOL_APPROVAL_DENIED',
    message: message ?? 'Tool call denied by approval policy.',
  },
  ok: false,
})

const createRequestSummary = (request: ToolApprovalRequest) =>
  `${request.toolName} ${request.risk}`

const createMissingPolicyDecision = (missingPolicy?: 'allow' | 'deny'): ToolApprovalDecision =>
  missingPolicy === 'allow'
    ? { type: 'allow' }
    : { type: 'deny' }

export const createToolApprovalPolicy = <TContext = unknown>(
  rules: ToolApprovalRule[],
  fallback: ToolApprovalDecision = { type: 'ask' },
) => (request: ToolApprovalRequest<TContext>): ToolApprovalDecision =>
  rules.find(rule =>
    (rule.toolName == null || rule.toolName === request.toolName)
    && (rule.risk == null || rule.risk === request.risk)
    && (rule.source == null || rule.source === request.source),
  )?.decision ?? fallback

export const toolApprovalHints = <TContext = unknown>(
  resolvers: Array<ToolApprovalHintsResolver<TContext>> | ToolApprovalHintsResolver<TContext>,
): AgentPlugin<TContext> => {
  const normalizedResolvers = normalizeHintsResolvers(resolvers)

  return {
    name: `${name}/hints`,
    resolveTools: ({ tools }) =>
      tools.map(tool => withToolApprovalHintsResolvers(tool, normalizedResolvers)),
    version,
  }
}

export const withToolApprovalHints = <TContext = unknown>(
  plugin: AgentPlugin<TContext>,
  resolvers: Array<ToolApprovalHintsResolver<TContext>> | ToolApprovalHintsResolver<TContext>,
): AgentPlugin<TContext> => {
  const normalizedResolvers = normalizeHintsResolvers(resolvers)

  return {
    ...plugin,
    resolveTools: async (options) => {
      const tools = await plugin.resolveTools?.(options)
      return tools?.map(tool => withToolApprovalHintsResolvers(tool, normalizedResolvers))
    },
  }
}

const pathApprovalHints = (
  source: string,
  risk: Exclude<ToolApprovalRisk, 'execute' | 'external' | 'network' | 'unknown'>,
  operation: string,
  input: unknown,
): ToolApprovalHints => {
  const { filePath } = input as { filePath?: string }
  return {
    risk,
    source,
    targets: filePath == null ? [] : [{ operation, type: 'path', value: filePath }],
  }
}

const bashApprovalHints = (source: string, input: unknown): ToolApprovalHints => {
  const { command, workdir } = input as { command?: string, workdir?: string }
  const targets: ToolApprovalTarget[] = []

  if (command != null)
    targets.push({ operation: 'execute', type: 'command', value: command })
  if (workdir != null)
    targets.push({ operation: 'cwd', type: 'path', value: workdir })

  return {
    risk: 'execute',
    source,
    targets,
  }
}

const networkApprovalHints = (
  source: string,
  input: unknown,
  field: 'query' | 'url',
): ToolApprovalHints => {
  const value = (input as { query?: string, url?: string })[field]
  return {
    risk: 'network',
    source,
    targets: value == null
      ? []
      : [{ operation: 'network', type: field === 'url' ? 'url' : 'custom', value }],
  }
}

export const commonToolsApprovalHints = (
  source = '@apeira/plugin-common-tools',
): ToolApprovalHintsResolver => ({ input, toolName }) => {
  const resolvers: Record<string, () => ToolApprovalHints> = {
    bash: () => bashApprovalHints(source, input),
    edit: () => pathApprovalHints(source, 'write', 'write', input),
    fetch: () => networkApprovalHints(source, input, 'url'),
    read: () => pathApprovalHints(source, 'read', 'read', input),
    search: () => networkApprovalHints(source, input, 'query'),
    write: () => pathApprovalHints(source, 'write', 'write', input),
  }

  return resolvers[toolName]?.()
}

export const mcpApprovalHints = (
  source = 'mcp',
): ToolApprovalHintsResolver => () => ({
  risk: 'external',
  source,
})

export const toolApproval = <TContext = unknown>(
  options: ToolApprovalOptions<TContext> = {},
): ToolApprovalPlugin<TContext> => {
  let mode = options.mode ?? 'ask'
  let policy = options.policy
  let clearConversationHistoryVersion = 0
  const clearedSessionVersions = new Map<string, number>()
  const turnAllows = new Map<string, Set<string>>()

  const applyPendingConversationClear = (privateState: PluginPrivateStateApi | undefined, sessionId: string) => {
    if (clearConversationHistoryVersion === 0)
      return

    if (clearedSessionVersions.get(sessionId) === clearConversationHistoryVersion)
      return

    setPrivateState(privateState, createInitialState())
    clearedSessionVersions.set(sessionId, clearConversationHistoryVersion)
  }

  return {
    clearHistory: () => {
      clearConversationHistoryVersion += 1
      clearedSessionVersions.clear()
      turnAllows.clear()
    },
    name,
    onTurnDone: ({ turnId }) => {
      turnAllows.delete(turnId)
    },
    preToolCall: async (hookOptions) => {
      applyPendingConversationClear(hookOptions.privateState, hookOptions.sessionId)

      if (mode === 'off')
        return { type: 'continue' }

      const hints = await resolveToolApprovalHints({
        context: hookOptions.context,
        input: hookOptions.input,
        tool: hookOptions.tool,
        toolName: hookOptions.toolName,
      })
      const classification = await options.classify?.({
        context: hookOptions.context,
        hints,
        input: hookOptions.input,
        tool: hookOptions.tool,
        toolName: hookOptions.toolName,
      })
      const request: ToolApprovalRequest<TContext> = {
        agentName: hookOptions.agentName,
        context: hookOptions.context,
        hints,
        input: hookOptions.input,
        risk: classification?.risk ?? hints.risk ?? 'unknown',
        sessionId: hookOptions.sessionId,
        signal: hookOptions.signal,
        source: classification?.source ?? hints.source,
        targets: classification?.targets ?? hints.targets ?? [],
        tool: hookOptions.tool,
        toolName: hookOptions.toolName,
        turnId: hookOptions.turnId,
      }
      const key = createApprovalKey(request)

      const decide = async (decision: ToolApprovalDecision, source: ToolApprovalDecisionEvent<TContext>['source']) => {
        try {
          await options.onDecision?.({ decision, request, source })
        }
        catch {
          // Decision reporting is observational; it must not change whether the tool runs.
        }
      }

      if (mode === 'deny') {
        const decision = { type: 'deny' } satisfies ToolApprovalDecision
        await decide(decision, 'policy')
        return { output: createDeniedOutput(), reason: 'Tool call denied by approval mode.', type: 'block' }
      }

      if (mode === 'allow') {
        const decision = { type: 'allow' } satisfies ToolApprovalDecision
        await decide(decision, 'policy')
        return { type: 'continue' }
      }

      const decision: ToolApprovalDecision = policy == null
        ? createMissingPolicyDecision(options.missingPolicy)
        : await policy(request)

      if (decision.type === 'deny') {
        await decide(decision, 'policy')
        return { output: createDeniedOutput(decision.message), reason: decision.message, type: 'block' }
      }

      if (decision.type === 'allow') {
        const scope = decision.scope ?? 'once'
        if (scope === 'turn') {
          const turnSet = turnAllows.get(hookOptions.turnId) ?? new Set<string>()
          turnSet.add(key)
          turnAllows.set(hookOptions.turnId, turnSet)
        }
        else if (scope === 'conversation') {
          const state = getPrivateState(hookOptions.privateState)
          state.allowed[key] = {
            createdAt: Date.now(),
            decision: 'allow',
            key,
            requestSummary: createRequestSummary(request),
            scope: 'conversation',
          }
          setPrivateState(hookOptions.privateState, state)
        }

        await decide({ ...decision, scope }, 'policy')
        return { type: 'continue' }
      }

      if (turnAllows.get(hookOptions.turnId)?.has(key) === true) {
        await decide({ scope: 'turn', type: 'allow' }, 'turn_cache')
        return { type: 'continue' }
      }

      if (getPrivateState(hookOptions.privateState).allowed[key] != null) {
        await decide({ scope: 'conversation', type: 'allow' }, 'context_history')
        return { type: 'continue' }
      }

      await decide(decision, 'policy')
      return { output: createDeniedOutput(decision.message), reason: decision.message, type: 'block' }
    },
    setMode: (nextMode) => {
      mode = nextMode
    },
    setPolicy: (nextPolicy) => {
      policy = nextPolicy
    },
    version,
  }
}
