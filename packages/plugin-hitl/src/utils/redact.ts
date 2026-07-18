import type { HITLEvent, HITLRequest } from '../types'

const SENSITIVE_KEY = /api[_-]?key|authorization|cookie|password|private[_-]?key|secret|token/i

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value))
    return value.map(redactValue)
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(item),
    ]))
  }
  return value
}

export const redactString = (value: string) => {
  try {
    return JSON.stringify(redactValue(JSON.parse(value)))
  }
  catch {
    return value.replace(
      /((?:api[_-]?key|authorization|cookie|password|private[_-]?key|secret|token)\s*[:=]\s*)[^\s,;]+/gi,
      '$1[REDACTED]',
    )
  }
}

export const redactRequest = (request: HITLRequest): HITLRequest => request.type === 'tool'
  ? {
      ...request,
      toolCall: {
        ...request.toolCall,
        args: redactString(request.toolCall.args),
      },
    }
  : {
      ...request,
      command: redactString(request.command),
      escalation: {
        ...request.escalation,
        justification: redactString(request.escalation.justification),
      },
    }

export const redactEvent = (event: HITLEvent): HITLEvent => ({
  ...event,
  request: redactRequest(event.request),
})
