import type { AutoReviewPolicy } from '../types'

const matchesPattern = (toolName: string, pattern: string) => {
  if (pattern === '*')
    return true

  if (pattern.startsWith('*') && pattern.endsWith('*'))
    return toolName.includes(pattern.slice(1, -1))

  if (pattern.startsWith('*'))
    return toolName.endsWith(pattern.slice(1))

  if (pattern.endsWith('*'))
    return toolName.startsWith(pattern.slice(0, -1))

  return toolName === pattern
}

export const autoReviewByPattern = (options: {
  always?: string[]
  never?: string[]
}): AutoReviewPolicy => {
  const always = options.always ?? []
  const never = options.never ?? []

  return (toolCall) => {
    if (never.some(pattern => matchesPattern(toolCall.toolName, pattern)))
      return { type: 'approve' }

    if (always.some(pattern => matchesPattern(toolCall.toolName, pattern)))
      return { type: 'pending' }

    return { type: 'pending' }
  }
}
