export const HITL_DEMO_ENV = 'APEIRA_HITL_DEMO'
export const HITL_RESUME_PREFIX = '<hitl_resume'

export type HITLDemoAction = 'approval-key' | 'conversation' | 'once' | 'reject' | 'turn'

export interface HITLDemoReplayOptions {
  toolName?: 'bash' | 'weather'
}

export interface HITLDemoRuntime {
  fetch: typeof globalThis.fetch
  reset: () => void
}

interface DemoTool {
  execute: (input: unknown, options?: unknown) => object | string | unknown[]
  function: {
    description?: string
    name: string
    parameters: Record<string, unknown>
    strict?: boolean
  }
  type: 'function'
}

interface FunctionCallItem {
  arguments: string
  call_id: string
  id: string
  name: string
  status: 'completed'
  type: 'function_call'
}

interface ImportMetaWithEnv {
  env?: Record<string, string | undefined>
}

interface MessageItem {
  content: Array<{ text: string, type: 'output_text' }>
  id: string
  role: 'assistant'
  status: 'completed'
  type: 'message'
}

interface ReplayBuildOutput {
  nextPendingAction: HITLDemoAction | undefined
  nextPendingCall: FunctionCallItem | undefined
  output: ReplayOutputItem[]
  shouldMarkTurnRepeatIssued: boolean | undefined
}

type ReplayOutputItem = FunctionCallItem | MessageItem

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value != null

const getRuntimeEnv = () => {
  const metaEnv = (import.meta as ImportMetaWithEnv).env
  const processKey: string = 'process'
  const processLike = (globalThis as Record<string, unknown>)[processKey]
  const processEnv = isRecord(processLike) && isRecord(processLike.env)
    ? processLike.env as Record<string, string | undefined>
    : undefined

  return {
    ...processEnv,
    ...metaEnv,
  }
}

export const isHitlDemoEnabled = () =>
  ((getRuntimeEnv()[HITL_DEMO_ENV] ?? getRuntimeEnv().VITE_APEIRA_HITL_DEMO) === '1')

export const createHitlResumeInput = (id: string, decision: 'approved' | 'rejected') =>
  `${HITL_RESUME_PREFIX} id="${id}" decision="${decision}">`

const parseBody = (init?: RequestInit) => {
  try {
    return JSON.parse(String(init?.body ?? '{}')) as { input?: unknown[] }
  }
  catch {
    return { input: [] }
  }
}

const textItem = (id: string, text: string): MessageItem => ({
  content: [{ text, type: 'output_text' }],
  id,
  role: 'assistant',
  status: 'completed',
  type: 'message',
})

const functionCall = (callId: string, name: string, args: Record<string, unknown>): FunctionCallItem => ({
  arguments: JSON.stringify(args),
  call_id: callId,
  id: `fc_${callId}`,
  name,
  status: 'completed',
  type: 'function_call',
})

const cloneFunctionCall = (item: FunctionCallItem, suffix: string): FunctionCallItem => ({
  ...item,
  call_id: `${item.call_id}_${suffix}`,
  id: `${item.id}_${suffix}`,
})

const sse = (event: unknown) =>
  `data: ${JSON.stringify(event)}\n\n`

const makeResponse = (events: unknown[]) =>
  new Response(new ReadableStream({
    start: (controller) => {
      const encoder = new TextEncoder()

      for (const event of events)
        controller.enqueue(encoder.encode(sse(event)))

      controller.close()
    },
  }), {
    headers: { 'Content-Type': 'text/event-stream' },
  })

const getTextFromItem = (item: unknown) => {
  if (!isRecord(item))
    return ''

  const content = item.content
  if (typeof content === 'string')
    return content

  if (!Array.isArray(content))
    return ''

  return content
    .flatMap((part) => {
      if (!isRecord(part))
        return []

      if (typeof part.text === 'string')
        return [part.text]

      return []
    })
    .join('\n')
}

const getLatestUserText = (input: unknown[]) => {
  const latestUserMessage = input.findLast(item => isRecord(item) && item.type === 'message' && item.role === 'user')
  return getTextFromItem(latestUserMessage)
}

const getCurrentFunctionOutput = (input: unknown[]) => {
  const latest = input.at(-1)
  return isRecord(latest) && latest.type === 'function_call_output' ? latest : undefined
}

const hasRejectedOutput = (item: Record<string, unknown> | undefined) =>
  typeof item?.output === 'string' && item.output.includes('TOOL_HITL_REJECTED')

const isHitlResumeText = (text: string) =>
  text.includes(HITL_RESUME_PREFIX) || text.includes('hitl-demo resume') || text.includes('HITL request')

const demoActions: HITLDemoAction[] = ['once', 'turn', 'conversation', 'reject', 'approval-key']

export const parseHitlDemoAction = (text: string): HITLDemoAction => {
  for (const action of demoActions) {
    if (text.includes(action))
      return action
  }

  return 'conversation'
}

const buildToolCallForAction = (
  action: HITLDemoAction,
  turnIndex: number,
  toolName: 'bash' | 'weather',
  approvalKeySafeIssued: boolean,
) => {
  if ((action === 'approval-key' && approvalKeySafeIssued)) {
    return functionCall(`call_danger_${turnIndex}`, 'bash', {
      command: 'rm -rf .',
      description: 'Dangerous command used to prove HITL keys are exact.',
    })
  }

  if (action === 'approval-key') {
    return functionCall(`call_status_${turnIndex}`, 'bash', {
      command: 'git status',
      description: 'Safe command used before the dangerous approval-key request.',
    })
  }

  if (toolName === 'weather') {
    return functionCall(`call_weather_${turnIndex}`, 'weather', {
      city: `Taipei ${action}`,
    })
  }

  const commands: Record<Exclude<HITLDemoAction, 'approval-key'>, { command: string, description: string }> = {
    conversation: {
      command: 'git status',
      description: 'Conversation-scope demo command.',
    },
    once: {
      command: 'git status --short',
      description: 'Once-scope demo command.',
    },
    reject: {
      command: 'git branch --show-current',
      description: 'Reject-path demo command.',
    },
    turn: {
      command: 'git diff --stat',
      description: 'Turn-scope demo command repeated in one run.',
    },
  }

  return functionCall(`call_${action}_${turnIndex}`, 'bash', commands[action])
}

const createIntroMessage = (action: HITLDemoAction, turnIndex: number) => {
  const intro = {
    'approval-key': '我会先请求执行安全命令；如果你选择 conversation allow，下一轮仍会对危险命令重新请求审批。',
    'conversation': '我准备调用一个可被 conversation allow 记住的工具。下一次相同参数应直接继续执行。',
    'once': '我准备调用一个 once/call scope 工具。允许一次后，下一次相同参数仍然需要审批。',
    'reject': '我准备调用一个工具；你可以拒绝它，agent 应该看到 TOOL_HITL_REJECTED 后继续说明。',
    'turn': '我准备调用一个 turn/run scope 工具。本轮恢复后会再次请求同一工具，用来验证 turn 级允许。',
  }[action]

  return textItem(`msg_intro_${turnIndex}`, intro)
}

const buildNextToolCall = (
  action: HITLDemoAction,
  turnIndex: number,
  toolName: 'bash' | 'weather',
  approvalKeySafeCompleted: boolean,
) =>
  buildToolCallForAction(action, turnIndex, toolName, approvalKeySafeCompleted)

const buildOutput = (
  input: unknown[],
  turnIndex: number,
  toolName: 'bash' | 'weather',
  approvalKeySafeCompleted: boolean,
  pendingCall: FunctionCallItem | undefined,
  pendingAction: HITLDemoAction | undefined,
  turnRepeatIssued: boolean,
): ReplayBuildOutput => {
  const userText = getLatestUserText(input)
  const currentFunctionOutput = getCurrentFunctionOutput(input)

  if (hasRejectedOutput(currentFunctionOutput)) {
    const message = textItem(`msg_rejected_${turnIndex}`, '用户拒绝了工具执行，我会继续保持当前状态，不执行该操作。')

    return { nextPendingAction: undefined, nextPendingCall: undefined, output: [message], shouldMarkTurnRepeatIssued: false }
  }

  if (currentFunctionOutput != null) {
    if (pendingAction === 'turn' && !turnRepeatIssued) {
      const repeat = buildNextToolCall('turn', turnIndex, toolName, approvalKeySafeCompleted)

      return {
        nextPendingAction: 'turn',
        nextPendingCall: repeat,
        output: [
          textItem(`msg_turn_repeat_${turnIndex}`, '同一轮恢复中，我会再次请求相同工具调用；turn/run allow 应该直接放行这一次。'),
          repeat,
        ],
        shouldMarkTurnRepeatIssued: true,
      }
    }

    const message = textItem(`msg_result_${turnIndex}`, '工具结果已返回：demo executor 已完成模拟执行。你可以继续下一轮测试。')

    return { nextPendingAction: undefined, nextPendingCall: undefined, output: [message], shouldMarkTurnRepeatIssued: false }
  }

  if (pendingCall != null && isHitlResumeText(userText)) {
    const resumedCall = cloneFunctionCall(pendingCall, `resume_${turnIndex}`)

    return {
      nextPendingAction: pendingAction,
      nextPendingCall: resumedCall,
      output: [
        textItem(`msg_resume_${turnIndex}`, '审批状态已更新，我会继续刚才等待人工确认的工具调用。'),
        resumedCall,
      ],
      shouldMarkTurnRepeatIssued: false,
    }
  }

  const action = parseHitlDemoAction(userText)
  const call = buildNextToolCall(action, turnIndex, toolName, approvalKeySafeCompleted)

  return {
    nextPendingAction: action,
    nextPendingCall: call,
    output: [createIntroMessage(action, turnIndex), call],
    shouldMarkTurnRepeatIssued: action !== 'turn' ? false : undefined,
  }
}

const createCompletedEvents = (output: ReplayOutputItem[], turnIndex: number) => {
  const events: unknown[] = [{ type: 'response.created' }]

  output.forEach((item, outputIndex) => {
    events.push({
      item,
      output_index: outputIndex,
      type: 'response.output_item.added',
    })

    if (item.type === 'message') {
      const content = item.content[0]
      if (content?.type === 'output_text') {
        events.push({
          content_index: 0,
          item_id: item.id,
          output_index: outputIndex,
          part: content,
          type: 'response.content_part.added',
        }, {
          content_index: 0,
          delta: content.text,
          item_id: item.id,
          output_index: outputIndex,
          type: 'response.output_text.delta',
        }, {
          content_index: 0,
          item_id: item.id,
          output_index: outputIndex,
          text: content.text,
          type: 'response.output_text.done',
        })
      }
    }

    if (item.type === 'function_call') {
      events.push({
        delta: item.arguments,
        item_id: item.id,
        output_index: outputIndex,
        type: 'response.function_call_arguments.delta',
      }, {
        arguments: item.arguments,
        item_id: item.id,
        output_index: outputIndex,
        type: 'response.function_call_arguments.done',
      })
    }

    events.push({
      item,
      output_index: outputIndex,
      type: 'response.output_item.done',
    })
  })

  events.push({
    response: {
      output,
      status: 'completed',
      usage: {
        input_tokens: 1,
        output_tokens: Math.max(1, output.length),
        total_tokens: Math.max(2, output.length + 1),
      },
    },
    sequence_number: turnIndex,
    type: 'response.completed',
  })

  return events
}

export const createHitlReplayFetch = (options: HITLDemoReplayOptions = {}): HITLDemoRuntime => {
  let approvalKeySafeCompleted = false
  let pendingAction: HITLDemoAction | undefined
  let pendingCall: FunctionCallItem | undefined
  let turnIndex = 0
  let turnRepeatIssued = false
  const toolName = options.toolName ?? 'bash'

  return {
    fetch: async (_url, init) => {
      turnIndex += 1

      const body = parseBody(init)
      const input = body.input ?? []
      const previousPendingCall = pendingCall
      const previousPendingAction = pendingAction
      const output = buildOutput(input, turnIndex, toolName, approvalKeySafeCompleted, pendingCall, pendingAction, turnRepeatIssued)
      const currentFunctionOutput = getCurrentFunctionOutput(input)

      pendingCall = output.nextPendingCall
      pendingAction = output.nextPendingAction

      if (output.shouldMarkTurnRepeatIssued === true)
        turnRepeatIssued = true
      else if (output.shouldMarkTurnRepeatIssued === false)
        turnRepeatIssued = false

      if (
        previousPendingCall?.name === 'bash'
        && previousPendingCall.arguments.includes('git status')
        && previousPendingAction === 'approval-key'
        && currentFunctionOutput != null
        && !hasRejectedOutput(currentFunctionOutput)
      ) {
        approvalKeySafeCompleted = true
      }

      return makeResponse(createCompletedEvents(output.output, turnIndex))
    },
    reset: () => {
      approvalKeySafeCompleted = false
      pendingAction = undefined
      pendingCall = undefined
      turnIndex = 0
      turnRepeatIssued = false
    },
  }
}

export const createHitlDemoTools = (): DemoTool[] => [
  {
    execute: (input: unknown) => {
      const command = isRecord(input) && typeof input.command === 'string'
        ? input.command
        : 'unknown'

      return {
        command,
        exitCode: 0,
        stdout: `demo: simulated ${command}`,
      }
    },
    function: {
      description: 'Demo-only shell command tool. It never executes a real command.',
      name: 'bash',
      parameters: {
        additionalProperties: false,
        properties: {
          command: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['command'],
        type: 'object',
      },
    },
    type: 'function',
  },
  {
    execute: (input: unknown) => ({
      city: isRecord(input) && typeof input.city === 'string' ? input.city : 'Taipei',
      forecast: 'sunny',
      source: 'hitl-demo',
    }),
    function: {
      description: 'Demo-only weather tool.',
      name: 'weather',
      parameters: {
        additionalProperties: false,
        properties: {
          city: { type: 'string' },
        },
        required: ['city'],
        type: 'object',
      },
    },
    type: 'function',
  },
]
