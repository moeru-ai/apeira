import type { ToolApprovalDecision, ToolApprovalRequest } from '@apeira/plugin-tool-approval'

import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'

export type ApprovalChoice = 'conversation' | 'deny' | 'once' | 'turn'

export type ApprovalChoiceProvider = (
  request: ToolApprovalRequest,
) => ApprovalChoice | Promise<ApprovalChoice>

export type InteractiveChoiceProvider = ApprovalChoiceProvider & {
  close: () => void
}

export const toDecision = (choice: ApprovalChoice): ToolApprovalDecision => {
  if (choice === 'deny')
    return { type: 'deny' }

  return { scope: choice, type: 'allow' }
}

export const formatApprovalRequest = (request: ToolApprovalRequest): string => [
  '',
  'Pending approval',
  '----------------',
  `Tool: ${request.toolName}`,
  `Risk: ${request.risk}`,
  `Source: ${request.source ?? 'unknown'}`,
  `Targets: ${request.targets.length === 0 ? 'none' : request.targets.map(target => `${target.type}:${target.value}`).join(', ')}`,
  `Input: ${JSON.stringify(request.input)}`,
].join('\n')

export const createInteractiveChoiceProvider = (): InteractiveChoiceProvider => {
  const readline = createInterface({ input, output })

  const provider = async (request: ToolApprovalRequest) => {
    output.write(formatApprovalRequest(request))
    output.write('\n\n1. allow once\n2. allow this turn\n3. allow conversation\n4. deny\n')

    while (true) {
      const answer = await readline.question('Choose approval option: ')
      if (answer === '1')
        return 'once'
      if (answer === '2')
        return 'turn'
      if (answer === '3')
        return 'conversation'
      if (answer === '4')
        return 'deny'

      output.write('Please choose 1, 2, 3, or 4.\n')
    }
  }

  provider.close = () => readline.close()
  return provider
}
