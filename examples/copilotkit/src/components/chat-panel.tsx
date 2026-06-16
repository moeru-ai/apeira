/* eslint-disable @masknet/browser-no-persistent-storage */
import type { AgentInput } from '@apeira/core'
import type { HITLRequestEvent } from '@apeira/plugin-hitl'

import { responses } from '@apeira/core/responses'
import { agui } from '@apeira/plugin-ag-ui'
import { hitl } from '@apeira/plugin-hitl'
import { kv } from '@apeira/storage/kv'
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from '@copilotkit/react-core/v2'
import { useEffect, useMemo, useState } from 'react'

import { useLLMSettings } from '../hooks/use-llm-settings'
import { cn } from '../lib/utils'
import { AbstractApeiraAgent } from '../utils/agent'
import { AGENT_ID, DEFAULT_INSTRUCTIONS } from '../utils/const'
import { getThreadStorePrefix } from '../utils/storage'
import { weatherTool } from '../utils/tools/weather'
import { ApprovalPanel } from './approval-panel'

import '@copilotkit/react-ui/v2/styles.css'

interface ChatPanelProps {
  className?: string
  onThreadUpdated: (threadId: string) => void
  threadId: string
}

export const ChatPanel = ({ className, onThreadUpdated, threadId }: ChatPanelProps) => {
  const { apiKey, baseURL, model } = useLLMSettings()
  const [approvalRequests, setApprovalRequests] = useState<HITLRequestEvent[]>([])

  const store = useMemo(() =>
    kv<AgentInput>({
      prefix: getThreadStorePrefix(threadId),
      storage: localStorage,
    }), [threadId])

  const agent = useMemo(() => new AbstractApeiraAgent({
    instructions: DEFAULT_INSTRUCTIONS,
    plugins: [
      hitl({
        toolPolicies: {
          'get-weather': {
            needsApproval: true,
          },
        },
      }),
      agui({ threadId }),
    ],
    runner: responses({
      apiKey,
      baseURL,
      model,
      tools: [
        weatherTool,
      ],
    }),
    store,
  }, onThreadUpdated, threadId), [apiKey, baseURL, model, onThreadUpdated, store, threadId])

  useEffect(() => {
    const unsubscribe = agent.subscribeHitl(threadId, (event) => {
      switch (event.type) {
        case 'control.approve':
        case 'control.reject':
        case 'hitl.auto_reviewed':
          return

        case 'hitl.request':
          setApprovalRequests((current) => {
            const next = current.filter(request => request.toolCallId !== event.toolCallId)
            return [...next, event]
          })
          return

        case 'hitl.resolved':
          setApprovalRequests(current => current.filter(request => request.toolCallId !== event.toolCallId))
      }
    })

    return () => {
      unsubscribe()
    }
  }, [agent, threadId])

  return (
    <div className={cn('flex h-full min-h-0 flex-col md:grid md:grid-cols-[minmax(0,1fr)_22rem]', className)}>
      <CopilotKitProvider agents__unsafe_dev_only={{ [AGENT_ID]: agent }}>
        <CopilotChatConfigurationProvider agentId={AGENT_ID} threadId={threadId}>
          <div className="min-h-0">
            <CopilotChat
              attachments={{ enabled: true }}
              key={threadId}
              labels={{ welcomeMessageText: 'Write a message...' }}
            />
          </div>
          <ApprovalPanel
            onApprove={toolCallId => agent.approve(toolCallId)}
            onReject={toolCallId => agent.reject(toolCallId, 'Rejected by user')}
            requests={approvalRequests}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    </div>
  )
}
