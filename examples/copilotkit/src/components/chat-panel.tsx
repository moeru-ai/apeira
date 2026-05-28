/* eslint-disable @masknet/browser-no-persistent-storage */

import type { Message } from '@copilotkit/react-core/v2'

import type { HITLDemoAction } from '../../../shared/hitl-demo'

import { agui } from '@apeira/plugin-ag-ui'
import { hitl } from '@apeira/plugin-hitl'
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
  defineToolCallRenderer,
  useAgent,
  useCopilotKit,
} from '@copilotkit/react-core/v2'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { createHitlDemoTools, createHitlReplayFetch, isHitlDemoEnabled } from '../../../shared/hitl-demo'
import { useLLMSettings } from '../hooks/use-llm-settings'
import { AbstractApeiraAgent } from '../utils/agent'
import { AGENT_ID, AGENT_NAME, DEFAULT_INSTRUCTIONS } from '../utils/const'
import { weatherTool } from '../utils/tools/weather'

import '@copilotkit/react-ui/v2/styles.css'

interface ChatPanelProps {
  className?: string
  onThreadUpdated: (threadId: string) => void
  threadId: string
}

type DemoScope = 'call' | 'conversation' | 'run'

interface DemoToolbarProps {
  agentInstance: AbstractApeiraAgent
  demoReplay: { reset: () => void }
  hitlControl: HitlControl
}

interface HitlControl {
  approve: (id: string, scope?: DemoScope) => boolean
  clear: () => void
  pending: () => Array<{ id: string }>
  reject: (id: string, message?: string) => boolean
}

interface HitlReview {
  args: string
  id: string
  reason: string
  tool: string
}

interface HitlToolCardProps {
  args: unknown
  hitlControl: HitlControl
  name: string
  result?: string
  status: unknown
  toolCallId: string
}

interface ToolRendererProps {
  args: unknown
  name: string
  result?: string
  status: unknown
  toolCallId: string
}

const demoActions: Array<{ action: HITLDemoAction, label: string }> = [
  { action: 'once', label: 'Start once' },
  { action: 'turn', label: 'Start turn' },
  { action: 'conversation', label: 'Start conversation' },
  { action: 'reject', label: 'Start reject' },
  { action: 'approval-key', label: 'Start approval-key' },
]

const toJson = (value: unknown) => {
  if (typeof value === 'string')
    return value

  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

const prettyJson = (value: string) => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  }
  catch {
    return value
  }
}

const parseHitlReview = (result: string | undefined): HitlReview | undefined => {
  if (result == null || !result.includes('HITL_REVIEW_REQUIRED'))
    return undefined

  const lines = Object.fromEntries(result.split('\n').flatMap((line) => {
    const [key, ...rest] = line.split('=')
    return key == null || rest.length === 0 ? [] : [[key, rest.join('=')]]
  }))

  if (lines.id == null)
    return undefined

  return {
    args: lines.args ?? '{}',
    id: lines.id,
    reason: lines.reason ?? 'Human review required.',
    tool: lines.tool ?? 'tool',
  }
}

const addUserMessage = (agent: ReturnType<typeof useAgent>['agent'], content: string) => {
  agent.addMessage({
    content,
    id: crypto.randomUUID(),
    role: 'user',
  } satisfies Message)
}

const useRunChatMessage = () => {
  const { agent } = useAgent({ agentId: AGENT_ID })
  const { copilotkit } = useCopilotKit()

  return useCallback(async (content: string) => {
    addUserMessage(agent, content)
    await copilotkit.runAgent({ agent })
  }, [agent, copilotkit])
}

const buttonClass = 'rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60'

const DemoToolbar = ({ agentInstance, demoReplay, hitlControl }: DemoToolbarProps) => {
  const runChatMessage = useRunChatMessage()
  const [runningAction, setRunningAction] = useState<HITLDemoAction>()

  const runAction = async (action: HITLDemoAction) => {
    setRunningAction(action)
    try {
      await runChatMessage(`hitl-demo ${action}`)
    }
    finally {
      setRunningAction(undefined)
    }
  }

  const clearDemo = () => {
    hitlControl.clear()
    demoReplay.reset()
    agentInstance.clearThread()
    agentInstance.setMessages([])
  }

  return (
    <div className="absolute left-12 right-4 top-3 z-20 flex flex-wrap items-center gap-2 border rounded-md bg-background/95 px-3 py-2 text-xs shadow-sm" data-testid="hitl-demo-toolbar">
      <span className="font-medium">HITL demo</span>
      {demoActions.map(({ action, label }) => {
        const buttonLabel = runningAction === action ? 'Running...' : label

        return (
          <button
            className={buttonClass}
            disabled={runningAction != null}
            key={action}
            onClick={() => void runAction(action)}
            type="button"
          >
            {buttonLabel}
          </button>
        )
      })}
      <button className={buttonClass} onClick={clearDemo} type="button">Clear demo state</button>
    </div>
  )
}

const HitlToolCard = ({ args, hitlControl, name, result, status, toolCallId }: HitlToolCardProps) => {
  const review = parseHitlReview(result)
  const reviewPending = review == null ? false : hitlControl.pending().some(request => request.id === review.id)
  const [busy, setBusy] = useState<'approved' | 'rejected'>()

  const decide = (decision: 'approved' | 'rejected', scope?: DemoScope) => {
    if (review == null)
      return

    const ok = decision === 'approved'
      ? hitlControl.approve(review.id, scope)
      : hitlControl.reject(review.id, 'TOOL_HITL_REJECTED: denied in CopilotKit demo')

    if (!ok)
      return

    setBusy(decision)
  }

  if (review != null && !reviewPending)
    return null

  if (review != null) {
    return (
      <div className="my-2 border border-amber-300 rounded-md bg-amber-50 p-3 text-sm text-amber-950" data-testid="hitl-review-card">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="font-medium">Human review required</span>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-mono">{review.tool}</span>
        </div>
        <div className="mb-2 text-xs text-amber-900">{review.reason}</div>
        <pre className="mb-3 max-h-40 overflow-auto rounded bg-background/80 p-2 text-xs leading-snug">{prettyJson(review.args)}</pre>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} disabled={busy != null} onClick={() => decide('approved', 'call')} type="button">Approve once</button>
          <button className={buttonClass} disabled={busy != null} onClick={() => decide('approved', 'run')} type="button">Approve turn</button>
          <button className={buttonClass} disabled={busy != null} onClick={() => decide('approved', 'conversation')} type="button">Approve conversation</button>
          <button className={buttonClass} disabled={busy != null} onClick={() => decide('rejected')} type="button">Reject</button>
        </div>
      </div>
    )
  }

  return (
    <div className="my-2 border rounded-md bg-muted/50 p-3 text-sm" data-testid="hitl-tool-card">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-medium">{name}</span>
        <span className="text-xs text-muted-foreground font-mono">{String(status)}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        toolCallId=
        {toolCallId}
      </div>
      <pre className="mt-2 max-h-36 overflow-auto rounded bg-background/80 p-2 text-xs leading-snug">{toJson(result ?? args)}</pre>
    </div>
  )
}

export const ChatPanel = ({ className, onThreadUpdated, threadId }: ChatPanelProps) => {
  const { apiKey, baseURL, model } = useLLMSettings()
  const demoEnabled = isHitlDemoEnabled()

  const demoReplay = useMemo(() => createHitlReplayFetch({
    toolName: 'weather',
  }), [])

  const hitlControl = useMemo(() => hitl({
    mode: 'ask',
    scope: 'conversation',
  }), [])

  useEffect(() => {
    hitlControl.clear()
    demoReplay.reset()
  }, [demoReplay, hitlControl, threadId])

  const agent = useMemo(() => {
    const instance = new AbstractApeiraAgent({
      instructions: demoEnabled
        ? `${DEFAULT_INSTRUCTIONS}\n\nYou are running in HITL demo mode.`
        : DEFAULT_INSTRUCTIONS,
      name: AGENT_NAME,
      options: {
        apiKey: demoEnabled ? 'hitl-demo' : apiKey,
        baseURL: demoEnabled ? 'https://hitl-demo.invalid/v1/' : baseURL,
        fetch: demoEnabled ? demoReplay.fetch : undefined,
        model: demoEnabled ? 'hitl-demo-replay' : model,
        tools: demoEnabled
          ? createHitlDemoTools()
          : [
              weatherTool,
            ],
      },
      plugins: [
        hitlControl.plugin,
        {
          name: 'browser-storage',
          storage: localStorage,
        },
        agui(),
      ],
    }, onThreadUpdated)

    instance.threadId = threadId
    return instance
  }, [apiKey, baseURL, demoEnabled, demoReplay, hitlControl, model, onThreadUpdated, threadId])

  const renderToolCalls = useMemo(() => demoEnabled
    ? [
        defineToolCallRenderer({
          name: '*',
          render: (props: ToolRendererProps) => (
            <HitlToolCard
              args={props.args}
              hitlControl={hitlControl}
              name={props.name}
              result={props.result}
              status={props.status}
              toolCallId={props.toolCallId}
            />
          ),
        }),
      ]
    : undefined, [demoEnabled, hitlControl])

  const demoToolbar = demoEnabled
    ? (
        <DemoToolbar
          agentInstance={agent}
          demoReplay={demoReplay}
          hitlControl={hitlControl}
        />
      )
    : undefined

  return (
    <div className={className}>
      <CopilotKitProvider
        agents__unsafe_dev_only={{ [AGENT_ID]: agent }}
        renderToolCalls={renderToolCalls}
      >
        <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={threadId}>
          {demoToolbar}
          <CopilotChat
            attachments={{ enabled: true }}
            key={threadId}
            labels={{ welcomeMessageText: 'Write a message...' }}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    </div>
  )
}
