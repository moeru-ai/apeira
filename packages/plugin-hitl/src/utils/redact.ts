import type { HITLEvent, HITLRequest } from '../types'

const SENSITIVE_KEY = /api[_-]?key|authorization|cookie|password|private[_-]?key|secret|token/i

const redactAssignment = (match: string) => {
  const separator = match.search(/[:=]/)
  return `${match.slice(0, separator + 1)}[REDACTED]`
}

const redactPlainString = (value: string) => value
  // Header and cookie options are opaque shell arguments; redact the whole value.
  .replace(/((?:^|\s)(?:-H|--header|--cookie|--user|--proxy-user|--oauth2-bearer)(?:\s+|=))(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, '$1[REDACTED]')
  .replace(/((?:^|\s)(?:-b|-u|-U)(?:\s+|=))(?:"[^"]*"|'[^']*'|[^\s;&|]+)/g, '$1[REDACTED]')
  .replace(/((?:^|\s)(?:-b|-u|-U))(?:"[^"]*"|'[^']*'|[^\s;&|]+)/g, '$1[REDACTED]')
  // Authorization and Cookie values commonly contain a scheme or several key/value pairs.
  .replace(/'((?:authorization|cookie)\s*:)[^']*'/gi, '\'$1[REDACTED]\'')
  .replace(/"((?:authorization|cookie)\s*:)[^"]*"/gi, '"$1[REDACTED]"')
  .replace(/(?:authorization|cookie)\s*:[^"';&|]+/gi, redactAssignment)
  .replace(/(?:api[_-]?key|password|private[_-]?key|secret|token)\s*[:=]\s*(?:"[^"]*"|'[^']*')/gi, redactAssignment)
  .replace(/(?:api[_-]?key|password|private[_-]?key|secret|token)\s*[:=]\s*[^"'\s,;&|]+/gi, redactAssignment)
  .replace(/--(?:api-key|password|secret|token)(?:=|\s+)(?:"[^"]*"|'[^']*'|[^\s;&|]+)/gi, '[REDACTED]')

const redactValue = (value: unknown): unknown => {
  if (Array.isArray(value))
    return value.map(redactValue)
  if (value != null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactValue(item),
    ]))
  }
  if (typeof value === 'string')
    return redactPlainString(value)
  return value
}

export const redactString = (value: string) => {
  try {
    return JSON.stringify(redactValue(JSON.parse(value)))
  }
  catch {
    return redactPlainString(value)
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
