/* eslint-disable @masknet/browser-no-persistent-storage */

import type { HITLRequestEvent } from '@apeira/plugin-hitl'

import { agui } from '@apeira/plugin-ag-ui'
import { approveToolCall, humanInTheLoop, rejectToolCall } from '@apeira/plugin-hitl'
import {
  CopilotChat,
  CopilotChatConfigurationProvider,
  CopilotKitProvider,
} from '@copilotkit/react-core/v2'
import { useEffect, useMemo, useState } from 'react'

import { useLLMSettings } from '../hooks/use-llm-settings'
import { cn } from '../lib/utils'
import { AbstractApeiraAgent } from '../utils/agent'
import { AGENT_ID, AGENT_NAME, DEFAULT_INSTRUCTIONS } from '../utils/const'
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

  const agent = useMemo(() => new AbstractApeiraAgent({
    instructions: DEFAULT_INSTRUCTIONS,
    name: AGENT_NAME,
    options: {
      apiKey,
      baseURL,
      model,
      tools: [
        weatherTool,
      ],
    },
    plugins: [
      {
        name: 'browser-storage',
        storage: localStorage,
      },
      humanInTheLoop({
        toolPolicies: {
          'get-weather': {
            needsApproval: true,
          },
        },
      }),
      agui(),
    ],
  }, onThreadUpdated), [apiKey, baseURL, model, onThreadUpdated])

  useEffect(() => {
    const unsubscribe = agent.subscribeHitl(threadId, (event) => {
      switch (event.type) {
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
            onApprove={approveToolCall}
            onReject={toolCallId => rejectToolCall(toolCallId, 'Rejected by user')}
            requests={approvalRequests}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    </div>
  )
}
