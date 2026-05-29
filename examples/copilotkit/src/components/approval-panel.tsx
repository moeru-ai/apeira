import type { HITLRequestEvent } from '@apeira/plugin-hitl'

import { Check, ShieldAlert, X } from 'lucide-react'

import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Separator } from './ui/separator'

interface ApprovalPanelProps {
  onApprove: (toolCallId: string) => void
  onReject: (toolCallId: string) => void
  requests: HITLRequestEvent[]
}

const compactJson = (value: string) => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2)
  }
  catch {
    return value
  }
}

export const ApprovalPanel = ({
  onApprove,
  onReject,
  requests,
}: ApprovalPanelProps) => {
  const hasRequests = requests.length > 0
  const statusText = hasRequests ? `${requests.length} pending` : 'No pending requests'
  const emptyState = (
    <div className="flex h-full min-h-32 items-center justify-center rounded-md border border-dashed px-4 text-center text-sm text-muted-foreground">
      Sensitive tool calls will pause here until approved.
    </div>
  )
  const requestList = (
    <div className="space-y-3">
      {requests.map((request: HITLRequestEvent) => (
        <section
          className={cn('rounded-md border bg-card p-3 text-card-foreground shadow-sm')}
          key={request.toolCallId}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{request.toolName}</div>
              <div className="truncate text-xs text-muted-foreground">{request.toolCallId}</div>
            </div>
            <div className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
              Waiting
            </div>
          </div>
          <pre className="mt-3 max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs leading-5 text-muted-foreground">
            {compactJson(request.args)}
          </pre>
          <div className="mt-3 flex items-center justify-end gap-2">
            <Button
              onClick={() => onReject(request.toolCallId)}
              size="sm"
              type="button"
              variant="outline"
            >
              <X className="size-4" />
              Reject
            </Button>
            <Button
              onClick={() => onApprove(request.toolCallId)}
              size="sm"
              type="button"
            >
              <Check className="size-4" />
              Approve
            </Button>
          </div>
        </section>
      ))}
    </div>
  )
  const content = hasRequests ? requestList : emptyState

  return (
    <aside className="flex h-full min-h-0 flex-col border-t bg-background md:border-l md:border-t-0">
      <div className="flex items-center gap-2 px-4 py-3">
        <ShieldAlert className="size-4 text-amber-600" />
        <div className="min-w-0">
          <div className="text-sm font-medium">Approvals</div>
          <div className="text-xs text-muted-foreground">{statusText}</div>
        </div>
      </div>
      <Separator />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{content}</div>
    </aside>
  )
}
