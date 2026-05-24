import type { AgentEvent, ItemParam } from '@apeira/core'
import type { ToolApprovalDecision, ToolApprovalDecisionEvent, ToolApprovalRequest } from '@apeira/plugin-tool-approval'

import { createAgent } from '@apeira/core'
import { toolApproval, toolApprovalHints } from '@apeira/plugin-tool-approval'
import { rawTool } from '@xsai/tool'

import './styles.css'

interface AssistantOutput {
  content: Array<{ text: string, type: 'output_text' }>
  phase: 'final_answer' | 'pre_tool'
  role: 'assistant'
  type: 'message'
}

interface ChatMessage {
  kind: 'agent' | 'user'
  text: string
}
interface FunctionCallOutput {
  arguments: string
  call_id: string
  id: string
  name: 'runCommand'
  status: 'completed'
  type: 'function_call'
}

type ModelOutput = AssistantOutput | FunctionCallOutput

type ModelResponse = readonly ModelOutput[]
interface PendingApproval {
  request: ToolApprovalRequest
  resolve: (decision: ToolApprovalDecision) => void
}

interface ReplayState {
  deniedToolOutputPending: boolean
  queue: ModelResponse[]
  turn: number
}
type ScenarioName = 'approval-key' | 'conversation' | 'deny' | 'runtime-policy-switch' | 'turn'
interface ToolActivity {
  command: string
  status: 'blocked' | 'success'
  toolName: string
}
type UserApprovalDecision = Extract<ToolApprovalDecision, { type: 'allow' } | { type: 'deny' }>

const scenarios: Record<ScenarioName, string> = {
  'approval-key': 'Approval key: first git status, then rm -rf .',
  'conversation': 'Conversation: repeat git status across turns',
  'deny': 'Deny: always ask to run rm -rf .',
  'runtime-policy-switch': 'Runtime policy switch: allow once, then force deny',
  'turn': 'Turn: two git status calls in one turn',
}

const state = {
  activities: [] as ToolActivity[],
  approvalEvents: [] as ToolApprovalDecisionEvent[],
  messages: [] as ChatMessage[],
  pendingApproval: undefined as PendingApproval | undefined,
  scenario: 'conversation' as ScenarioName,
}

const replayState: ReplayState = {
  deniedToolOutputPending: false,
  queue: [],
  turn: 0,
}

const app = document.querySelector<HTMLDivElement>('#app')!

const createUserMessage = (content: string): ItemParam => ({
  content,
  role: 'user',
  type: 'message',
})

const sse = (event: unknown) =>
  `data: ${JSON.stringify(event)}\n\n`

const createResponseStream = (outputs: ModelResponse) => {
  const encoder = new TextEncoder()

  return new Response(new ReadableStream({
    start: (controller) => {
      controller.enqueue(encoder.encode(sse({ type: 'response.created' })))
      outputs.forEach((item, outputIndex) => {
        controller.enqueue(encoder.encode(sse({
          item,
          output_index: outputIndex,
          type: 'response.output_item.done',
        })))
      })
      controller.enqueue(encoder.encode(sse({
        response: {
          output: outputs,
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
        },
        type: 'response.completed',
      })))
      controller.close()
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

const assistantMessage = (
  text: string,
  phase: AssistantOutput['phase'] = 'final_answer',
): AssistantOutput => ({
  content: [{ text, type: 'output_text' }],
  phase,
  role: 'assistant',
  type: 'message',
})

const preToolMessageForCommand = (command: string) => {
  if (command === 'rm -rf .')
    return 'I need to inspect a risky command before I can continue. I will request approval before doing anything destructive.'

  return 'I will check the repository status first, then use the result to answer.'
}

const functionCall = (command: string, index: number): FunctionCallOutput => ({
  arguments: JSON.stringify({ command }),
  call_id: `call_${replayState.turn}_${index}`,
  id: `fc_${replayState.turn}_${index}`,
  name: 'runCommand',
  status: 'completed',
  type: 'function_call',
})

const finalMessageForCommand = (command: string) => {
  if (command === 'rm -rf .')
    return 'I asked to run a destructive command. If it was denied, I will avoid that path and suggest a safer alternative.'

  return 'I checked the repository status and can continue from the tool result.'
}

const deniedFinalMessage = () =>
  'The approval layer denied the tool call, so I will not treat it as executed. I can continue with a safer alternative.'

const buildTurnOutputs = () => {
  if (state.scenario === 'turn') {
    return [
      [
        assistantMessage('I will check the repository status twice in this turn so the turn approval behavior is visible.', 'pre_tool'),
        functionCall('git status', 0),
        functionCall('git status', 1),
      ],
      [assistantMessage('I checked the same command twice in this turn, so you can see how turn-scoped approval behaves.')],
    ]
  }

  const command = state.scenario === 'deny'
    ? 'rm -rf .'
    : state.scenario === 'approval-key' && replayState.turn > 0
      ? 'rm -rf .'
      : 'git status'

  return [
    [
      assistantMessage(preToolMessageForCommand(command), 'pre_tool'),
      functionCall(command, 0),
    ],
    [assistantMessage(finalMessageForCommand(command))],
  ]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object'

const renderPreToolMessages = (outputs: ModelResponse) => {
  for (const item of outputs) {
    if (item.type !== 'message' || item.role !== 'assistant' || item.phase !== 'pre_tool')
      continue

    const text = item.content
      .filter(isRecord)
      .filter(part => part.type === 'output_text' && typeof part.text === 'string')
      .map(part => part.text)
      .join('')

    if (text.length > 0)
      state.messages.push({ kind: 'agent', text })
  }

  render()
}

const fakeFetch: typeof globalThis.fetch = async () => {
  if (replayState.queue.length === 0) {
    replayState.queue = buildTurnOutputs()
    replayState.turn += 1
  }

  let outputs: ModelResponse = replayState.queue.shift() ?? [assistantMessage('No tool call requested.')]
  if (replayState.deniedToolOutputPending) {
    outputs = [assistantMessage(deniedFinalMessage())]
    replayState.deniedToolOutputPending = false
  }

  renderPreToolMessages(outputs)

  return createResponseStream(outputs)
}

const storageValues = new Map<string, string>()
const promptMemory = new Map<string, { scope: 'conversation' | 'turn', turnId: string }>()

const createRequestKey = (request: ToolApprovalRequest) =>
  JSON.stringify({
    input: request.input,
    risk: request.risk,
    source: request.source,
    targets: request.targets,
    toolName: request.toolName,
  })

const waitForApproval = async (request: ToolApprovalRequest) =>
  new Promise<ToolApprovalDecision>((resolve) => {
    state.pendingApproval = { request, resolve }
    render()
  })

const approvals = toolApproval({
  mode: 'ask',
  onDecision: (event) => {
    state.approvalEvents.unshift(event)
    render()
  },
  policy: async (request) => {
    const key = createRequestKey(request)
    const memory = promptMemory.get(key)
    if (memory?.scope === 'conversation' || (memory?.scope === 'turn' && memory.turnId === request.turnId))
      return { type: 'ask' }

    const decision = await waitForApproval(request)
    if (decision.type === 'allow' && (decision.scope === 'conversation' || decision.scope === 'turn'))
      promptMemory.set(key, { scope: decision.scope, turnId: request.turnId })

    return decision
  },
})

const agent = createAgent({
  instructions: 'Ignore user text and request the replayed tool call.',
  name: 'tool-approval-ui',
  options: {
    apiKey: 'fake',
    baseURL: 'https://example.test/v1/',
    fetch: fakeFetch,
    model: 'fake-model',
  },
  plugins: [{
    name: 'safe-tools',
    resolveTools: () => [
      rawTool({
        description: 'Simulate running a shell command.',
        execute: (input) => {
          const command = (input as { command?: string }).command ?? ''
          state.activities.unshift({ command, status: 'success', toolName: 'runCommand' })
          render()
          return { ok: true, output: `simulated: ${command}` }
        },
        name: 'runCommand',
        parameters: {
          properties: {
            command: { type: 'string' },
          },
          required: ['command'],
          type: 'object',
        },
      }),
    ],
  }, toolApprovalHints(({ input, toolName }) => {
    if (toolName !== 'runCommand')
      return

    const { command } = input as { command?: string }
    return {
      risk: 'execute',
      source: '@apeira/example-tool-approval-ui',
      targets: command == null ? [] : [{ operation: 'execute', type: 'command', value: command }],
    }
  }), approvals, {
    name: 'approval-audit',
    postToolCall: (event) => {
      if (event.status !== 'blocked')
        return
      state.activities.unshift({
        command: JSON.stringify(event.input),
        status: 'blocked',
        toolName: event.toolName,
      })
      replayState.deniedToolOutputPending = true
      render()
    },
  }, {
    name: 'storage',
    storage: {
      getItem: key => storageValues.get(key),
      removeItem: (key) => {
        storageValues.delete(key)
      },
      setItem: (key, value) => {
        storageValues.set(key, value)
      },
    },
  }],
})

const extractAssistantText = (item: unknown) => {
  if (!isRecord(item) || item.type !== 'message' || item.role !== 'assistant' || !Array.isArray(item.content))
    return undefined

  if (item.phase === 'pre_tool')
    return undefined

  const text = item.content
    .filter(isRecord)
    .filter(part => part.type === 'output_text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('')

  return text.length > 0 ? text : undefined
}

const getAssistantText = (event: unknown) => {
  if (!isRecord(event))
    return undefined

  if (event.type === 'response.output_item.done')
    return extractAssistantText(event.item)

  if (event.type !== 'step.done' || !Array.isArray(event.output))
    return undefined

  const text = event.output
    .map(extractAssistantText)
    .filter((text): text is string => text != null)
    .join('')

  return text.length > 0 ? text : undefined
}

const readEventStream = async (stream: ReadableStream<AgentEvent>) => {
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done)
        break

      const assistantText = getAssistantText(value)
      if (assistantText != null) {
        state.messages.push({ kind: 'agent', text: assistantText })
        render()
      }
    }
  }
  finally {
    reader.releaseLock()
  }
}

const approve = (decision: UserApprovalDecision) => {
  const pending = state.pendingApproval
  if (pending == null)
    return

  state.pendingApproval = undefined
  pending.resolve(decision)
  render()
}

const sendMessage = async () => {
  const input = document.querySelector<HTMLInputElement>('#message-input')!
  const content = input.value.trim() || 'Run the next tool call.'
  input.value = ''
  state.messages.push({ kind: 'user', text: content })
  render()
  await readEventStream(agent.run(createUserMessage(content)))
  if (state.scenario === 'runtime-policy-switch' && replayState.turn === 1)
    approvals.setMode('deny')
  render()
}

const resetScenario = (scenario: ScenarioName) => {
  state.scenario = scenario
  state.activities = []
  state.pendingApproval = undefined
  state.approvalEvents = []
  state.messages = []
  replayState.queue = []
  replayState.deniedToolOutputPending = false
  replayState.turn = 0
  promptMemory.clear()
  storageValues.clear()
  approvals.setMode('ask')
  render()
}

const renderApproval = () => {
  const pending = state.pendingApproval
  if (pending == null) {
    return '<section class="approval empty">No pending approval. Send a message to trigger a tool call.</section>'
  }

  const { request } = pending
  const targets = request.targets.length === 0
    ? 'none'
    : request.targets.map(target => `${target.type}:${target.value}`).join(', ')

  return `
    <section class="approval pending">
      <span class="label">Pending approval</span>
      <div class="kv">
        <span>Tool</span><span>${request.toolName}</span>
        <span>Risk</span><span>${request.risk}</span>
        <span>Source</span><span>${request.source ?? 'unknown'}</span>
        <span>Targets</span><span>${targets}</span>
      </div>
      <div class="code">${JSON.stringify(request.input, null, 2)}</div>
      <div class="approval-actions">
        <button data-approval="once">Allow once</button>
        <button data-approval="turn">Allow turn</button>
        <button data-approval="conversation">Allow conversation</button>
        <button class="deny" data-approval="deny">Deny</button>
      </div>
    </section>
  `
}

// eslint-disable-next-line prefer-arrow/prefer-arrow-functions
function render() {
  const renderedMessages = state.messages.map(message => `
    <article class="message ${message.kind}">
      <span class="label">${message.kind}</span>
      ${message.text}
    </article>
  `).join('') || '<p class="empty-chat">Send a message to start the fake agent turn.</p>'
  const renderedScenarios = Object.entries(scenarios).map(([value, label]) => `
    <option value="${value}" ${value === state.scenario ? 'selected' : ''}>${label}</option>
  `).join('')
  const renderedEvents = state.approvalEvents.map(event => `
    <div class="event">
      <strong>${event.decision.type}</strong> from ${event.source}<br>
      ${event.request.toolName}
    </div>
  `).join('') || '<p class="event">No decisions yet.</p>'
  const renderedActivities = state.activities.map(activity => `
    <div class="activity ${activity.status}">
      <span class="activity-dot"></span>
      <div>
        <strong>${activity.toolName}</strong>
        <span>${activity.status}</span>
        <code>${activity.command}</code>
      </div>
    </div>
  `).join('') || '<p class="event">No tool activity yet.</p>'
  const approval = renderApproval()

  // eslint-disable-next-line @masknet/browser-no-set-html
  app.innerHTML = `
    <div class="app">
      <section class="chat">
        <header class="header">
          <h1>Tool Approval UI Playground</h1>
          <p>The fake agent ignores user text, proposes tool calls, then returns normal assistant text.</p>
        </header>
        <section class="messages">
          ${renderedMessages}
        </section>
        <form class="composer" id="composer">
          <input id="message-input" placeholder="Type anything. The fake agent will request a tool call." autocomplete="off">
          <button type="submit">Send</button>
        </form>
      </section>
      <aside class="side">
        <header class="side-header">
          <h2>Approval</h2>
          <p>Current scenario controls which tool call the agent proposes.</p>
        </header>
        <section class="scenario">
          <label for="scenario-select" class="label">Scenario</label>
          <select id="scenario-select">
            ${renderedScenarios}
          </select>
        </section>
        ${approval}
        <section class="events">
          <span class="label">Decision events</span>
          ${renderedEvents}
        </section>
        <section class="events">
          <span class="label">Tool activity</span>
          ${renderedActivities}
        </section>
      </aside>
    </div>
  `

  document.querySelector<HTMLFormElement>('#composer')?.addEventListener('submit', (event) => {
    event.preventDefault()
    void sendMessage()
  })
  document.querySelector<HTMLSelectElement>('#scenario-select')?.addEventListener('change', (event) => {
    resetScenario((event.target as HTMLSelectElement).value as ScenarioName)
  })
  document.querySelectorAll<HTMLButtonElement>('[data-approval]').forEach((button) => {
    button.addEventListener('click', () => {
      const choice = button.dataset.approval
      if (choice === 'deny')
        approve({ type: 'deny' })
      else if (choice === 'once' || choice === 'turn' || choice === 'conversation')
        approve({ scope: choice, type: 'allow' })
    })
  })

  const messages = document.querySelector<HTMLElement>('.messages')
  if (messages != null)
    messages.scrollTop = messages.scrollHeight
}

// eslint-disable-next-line @masknet/no-top-level
render()
