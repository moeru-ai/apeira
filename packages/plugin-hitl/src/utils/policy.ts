import type { AutoReviewPolicy } from '../types'

export const autoReviewByPattern = (options: {
  always?: string[]
  never?: string[]
}): AutoReviewPolicy => {
  const always = new Set(options.always ?? [])
  const never = new Set(options.never ?? [])

  return (toolCall) => {
    if (never.has(toolCall.toolName))
      return { type: 'approve' }

    if (always.has(toolCall.toolName))
      return { type: 'pending' }

    return { type: 'pending' }
  }
}
