import { exec } from 'node:child_process'
import { promisify } from 'node:util'

import { rawTool } from '@apeira/core'

const execAsync = promisify(exec)

export const createBashTool = () => rawTool({
  description: 'Execute a shell command with timeout support. Use for running scripts, building projects, git operations, and any command-line tasks.',
  execute: async (input: unknown) => {
    const { command, timeout = 60_000, workdir } = input as { command: string, timeout?: number, workdir?: string }

    const cmd = workdir != null ? `cd ${JSON.stringify(workdir)} && ${command}` : command

    const { stderr, stdout } = await execAsync(cmd, {
      maxBuffer: 10 * 1024 * 1024,
      timeout,
    })

    const parts: string[] = []

    if (stdout != null && stdout.length > 0)
      parts.push(stdout)
    if (stderr != null && stderr.length > 0)
      parts.push(`stderr:\n${stderr}`)

    return parts.join('\n')
  },
  name: 'bash',
  parameters: {
    properties: {
      command: { description: 'The shell command to execute.', type: 'string' },
      description: { description: 'A brief description of what the command does, for context.', type: 'string' },
      timeout: { description: 'Maximum execution time in milliseconds (default: 60000).', type: 'number' },
      workdir: { description: 'Working directory for the command.', type: 'string' },
    },
    required: ['command'],
    title: 'bash_parameters',
    type: 'object',
  },
})
