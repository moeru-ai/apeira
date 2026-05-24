import { rawTool } from '@xsai/tool'

export interface ToolExecution {
  input: unknown
  toolName: string
}

type Tool = ReturnType<typeof rawTool>

export const createSafeTools = (
  executions: ToolExecution[],
  onToolActivity?: (execution: ToolExecution) => void,
): Tool[] => [
  rawTool({
    description: 'Simulate running a shell command without executing it.',
    execute: (input) => {
      const execution = { input, toolName: 'runCommand' }
      executions.push(execution)
      onToolActivity?.(execution)
      return {
        ok: true,
        output: `simulated: ${(input as { command?: string }).command ?? ''}`,
      }
    },
    name: 'runCommand',
    parameters: {
      properties: {
        command: { type: 'string' },
      },
      required: ['command'],
      type: 'object',
    },
  }),
]
