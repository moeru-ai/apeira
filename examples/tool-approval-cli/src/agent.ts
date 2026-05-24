import type { AgentEvent } from '@apeira/core'
import type { ToolApprovalDecisionEvent, ToolApprovalRequest } from '@apeira/plugin-tool-approval'

import type { ApprovalChoiceProvider } from './approval-prompt'
import type { FakeModelTurn } from './fake-model'
import type { ToolExecution } from './safe-tools'

import { createAgent } from '@apeira/core'
import { toolApproval, toolApprovalHints } from '@apeira/plugin-tool-approval'

import { toDecision } from './approval-prompt'
import { createFakeModelFetch, createUserMessage } from './fake-model'
import { createSafeTools } from './safe-tools'

export interface MemoryStorage {
  getItem: (key: string) => string | undefined
  removeItem: (key: string) => void
  setItem: (key: string, value: string) => void
  values: Map<string, string>
}

export interface ScenarioReporter {
  onAssistantMessage?: (text: string) => void
  onDecision?: (event: ToolApprovalDecisionEvent) => void
  onModeSwitch?: (mode: 'deny') => void
  onToolActivity?: (execution: ToolExecution) => void
  onUserMessage?: (text: string) => void
}

export interface ScenarioRunOptions {
  choiceProvider: ApprovalChoiceProvider
  modeSwitchAfterTurn?: number
  reporter?: ScenarioReporter
  turns: FakeModelTurn[]
}

export interface ScenarioRunResult {
  approvalEvents: ToolApprovalDecisionEvent[]
  approvalPrompts: ToolApprovalRequest[]
  modelInputs: unknown[][]
  storage: MemoryStorage
  toolExecutions: ToolExecution[]
}

const createMemoryStorage = (): MemoryStorage => {
  const values = new Map<string, string>()

  return {
    getItem: key => values.get(key),
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
    values,
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object'

const extractAssistantText = (item: unknown) => {
  if (!isRecord(item) || item.type !== 'message' || item.role !== 'assistant' || item.phase === 'pre_tool' || !Array.isArray(item.content))
    return undefined

  const text = item.content
    .filter(isRecord)
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')

  return text.length > 0 ? text : undefined
}

const getAssistantText = (event: AgentEvent) => {
  if (event.type !== 'step.done' || !Array.isArray(event.output))
    return undefined

  const text = event.output
    .map(extractAssistantText)
    .filter((item): item is string => item != null)
    .join('')

  return text.length > 0 ? text : undefined
}

const readEventStream = async (
  stream: ReadableStream<AgentEvent>,
  reporter?: ScenarioReporter,
) => {
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      const assistantText = getAssistantText(value)
      if (assistantText != null)
        reporter?.onAssistantMessage?.(assistantText)
    }
  }
  finally {
    reader.releaseLock()
  }
}

const createRequestKey = (request: ToolApprovalRequest) =>
  JSON.stringify({
    input: request.input,
    risk: request.risk,
    source: request.source,
    targets: request.targets,
    toolName: request.toolName,
  })

export const runScenarioWithTurns = async (options: ScenarioRunOptions): Promise<ScenarioRunResult> => {
  const approvalEvents: ToolApprovalDecisionEvent[] = []
  const approvalPrompts: ToolApprovalRequest[] = []
  const promptMemory = new Map<string, { scope: 'conversation' | 'turn', turnId: string }>()
  const toolExecutions: ToolExecution[] = []
  const storage = createMemoryStorage()
  const fakeModel = createFakeModelFetch(options.turns, {
    onPreToolMessage: text => options.reporter?.onAssistantMessage?.(text),
  })
  const approvals = toolApproval({
    mode: 'ask',
    onDecision: (event) => {
      approvalEvents.push(event)
      options.reporter?.onDecision?.(event)
    },
    policy: async (request) => {
      const key = createRequestKey(request)
      const memory = promptMemory.get(key)
      if (memory?.scope === 'conversation' || (memory?.scope === 'turn' && memory.turnId === request.turnId))
        return { type: 'ask' }

      approvalPrompts.push(request)
      const choice = await options.choiceProvider(request)
      if (choice === 'conversation' || choice === 'turn')
        promptMemory.set(key, { scope: choice, turnId: request.turnId })

      return toDecision(choice)
    },
  })
  const agent = createAgent({
    instructions: 'Use tools and explain approval results.',
    name: 'tool-approval-cli',
    options: {
      apiKey: 'fake',
      baseURL: 'https://example.test/v1/',
      fetch: fakeModel.fetch,
      model: 'fake-model',
    },
    plugins: [{
      name: 'safe-tools',
      resolveTools: () => createSafeTools(toolExecutions, options.reporter?.onToolActivity),
    }, toolApprovalHints(({ input, toolName }) => {
      if (toolName !== 'runCommand')
        return

      const { command } = input as { command?: string }
      return {
        risk: 'execute',
        source: '@apeira/example-tool-approval-cli',
        targets: command == null ? [] : [{ operation: 'execute', type: 'command', value: command }],
      }
    }), approvals, {
      name: 'storage',
      storage,
    }],
  })

  for (const [index, turn] of options.turns.entries()) {
    options.reporter?.onUserMessage?.(turn.prompt)
    await readEventStream(agent.run(createUserMessage(turn.prompt)), options.reporter)

    if (options.modeSwitchAfterTurn === index) {
      approvals.setMode('deny')
      options.reporter?.onModeSwitch?.('deny')
    }
  }

  return {
    approvalEvents,
    approvalPrompts,
    modelInputs: fakeModel.inputs,
    storage,
    toolExecutions,
  }
}
