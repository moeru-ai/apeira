import type { AgentEntry } from '@apeira/core'
import type { ToolRequest } from '@apeira/plugin-hitl'

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
  const [approvalRequests, setApprovalRequests] = useState<ToolRequest[]>([])

  const storage = useMemo(() =>
    kv<AgentEntry>({
      backend: localStorage,
      prefix: getThreadStorePrefix(threadId),
    }), [threadId])

  const { agent, approval } = useMemo(() => {
    const approval = hitl()
    const agent = new AbstractApeiraAgent({
      instructions: DEFAULT_INSTRUCTIONS,
      plugins: [
        approval,
        agui({ threadId }),
      ],
      runner: responses({
        apiKey,
        baseURL,
        model,
      }),
      storage,
      tools: [
        weatherTool,
      ],
    }, onThreadUpdated, threadId)
    return { agent, approval }
  }, [apiKey, baseURL, model, onThreadUpdated, storage, threadId])

  useEffect(() => {
    const unsubscribe = agent.subscribeHitl(threadId, (event) => {
      switch (event.type) {
        case 'cancelled':
          setApprovalRequests(current => current.filter(request => request.requestId !== event.request.requestId))
          break

        case 'request': {
          if (event.request.type !== 'tool')
            return

          const request = event.request
          setApprovalRequests((current) => {
            const next = current.filter(item => item.requestId !== request.requestId)
            return [...next, request]
          })
          return
        }

        case 'resolved':
          setApprovalRequests(current => current.filter(request => request.requestId !== event.request.requestId))
          break
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
            onApprove={requestId => approval.resolve(requestId, { type: 'approve' })}
            onReject={requestId => approval.resolve(requestId, { message: 'Rejected by user', type: 'reject' })}
            requests={approvalRequests}
          />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    </div>
  )
}
