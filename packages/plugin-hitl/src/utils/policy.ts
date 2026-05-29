import type { AutoReviewPolicy, ToolNamePattern } from '../types'

const matchesPattern = (toolName: string, pattern: ToolNamePattern) => {
  if (pattern instanceof RegExp)
    return pattern.test(toolName)

  return toolName === pattern
}

export const autoReviewByPattern = (options: {
  always?: ToolNamePattern[]
  never?: ToolNamePattern[]
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
