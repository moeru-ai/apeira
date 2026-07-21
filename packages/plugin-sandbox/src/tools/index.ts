import type { AgentPlugin } from '@apeira/core'

import type { EscalationRequest, PermissionDelta, Sandbox } from '../types'

import { rawTool } from '@apeira/core'

import { name as packageName, version } from '../../package.json'

export interface ToolPermissionInput {
  additional_permissions?: {
    file_system?: {
      read?: string[]
      write?: string[]
    }
    network?: {
      allow_local_binding?: boolean
      domains?: string[]
      unix_sockets?: string[]
    }
  }
  justification?: string
  sandbox_permissions?: 'require_escalated' | 'use_default'
}

const toPermissionDelta = (
  input: ToolPermissionInput['additional_permissions'],
): PermissionDelta | undefined => {
  if (input == null)
    return undefined

  const hasPermissions = (input.file_system?.read?.length ?? 0) > 0
    || (input.file_system?.write?.length ?? 0) > 0
    || (input.network?.domains?.length ?? 0) > 0
    || (input.network?.unix_sockets?.length ?? 0) > 0
    || input.network?.allow_local_binding === true
  if (!hasPermissions)
    return undefined

  return {
    fileSystem: {
      allowRead: input.file_system?.read,
      allowWrite: input.file_system?.write,
    },
    network: {
      allowedDomains: input.network?.domains,
      allowLocalBinding: input.network?.allow_local_binding,
      allowUnixSockets: input.network?.unix_sockets,
    },
  }
}

const toEscalation = (input: ToolPermissionInput): EscalationRequest | undefined => {
  if (input.sandbox_permissions !== 'require_escalated')
    return undefined

  const justification = input.justification?.trim()
  if (justification == null || justification.length === 0)
    throw new Error('require_escalated requires a non-empty justification')

  const permissions = toPermissionDelta(input.additional_permissions)
  return permissions == null
    ? { justification, type: 'bypass' }
    : { justification, permissions, type: 'expand' }
}

const permissionProperties = {
  additional_permissions: {
    additionalProperties: false,
    description: 'The smallest filesystem or network permission expansion needed for this call.',
    properties: {
      file_system: {
        additionalProperties: false,
        properties: {
          read: { items: { type: 'string' }, type: 'array' },
          write: { items: { type: 'string' }, type: 'array' },
        },
        type: 'object',
      },
      network: {
        additionalProperties: false,
        properties: {
          allow_local_binding: { type: 'boolean' },
          domains: { items: { type: 'string' }, type: 'array' },
          unix_sockets: { items: { type: 'string' }, type: 'array' },
        },
        type: 'object',
      },
    },
    type: 'object',
  },
  justification: {
    description: 'Why this call needs to exceed the default sandbox profile.',
    type: 'string',
  },
  sandbox_permissions: {
    default: 'use_default',
    description: 'Use the default sandbox or ask the configured authorizer for additional permissions.',
    enum: ['use_default', 'require_escalated'] as Array<'require_escalated' | 'use_default'>,
    type: 'string',
  },
} as const

export interface ApplyPatchToolInput {
  additional_permissions?: NonNullable<ToolPermissionInput['additional_permissions']>
  cwd?: string
  justification?: string
  /** A standard unified diff accepted by git apply. */
  patch: string
  sandbox_permissions?: NonNullable<ToolPermissionInput['sandbox_permissions']>
  timeout_ms?: number
}

export interface ExecToolInput extends ToolPermissionInput {
  command: string
  cwd?: string
  env?: Record<string, string>
  max_output_bytes?: number
  timeout_ms?: number
  yield_time_ms?: number
}

export interface SandboxToolsOptions {
  ownerId?: string
  sandbox: Sandbox
}

export interface WriteStdinToolInput {
  chars?: string
  close?: boolean
  session_id: string
  terminate?: boolean
  yield_time_ms?: number
}

export const createExecTool = (options: SandboxToolsOptions) => rawTool<ExecToolInput>({
  description: 'Run a shell command in the configured sandbox. Long-running commands return a session id for write_stdin.',
  execute: async (input, executeOptions) => options.sandbox.execute({
    command: input.command,
    cwd: input.cwd,
    env: input.env,
    escalation: toEscalation(input),
    maxOutputBytes: input.max_output_bytes,
    ownerId: options.ownerId,
    requestId: executeOptions.toolCallId,
    timeoutMs: input.timeout_ms,
    yieldTimeMs: input.yield_time_ms ?? 10_000,
  }, { signal: executeOptions.abortSignal }),
  name: 'exec',
  parameters: {
    additionalProperties: false,
    properties: {
      command: { description: 'Shell command to execute.', type: 'string' },
      cwd: { description: 'Working directory. Defaults to the host process cwd.', type: 'string' },
      env: {
        additionalProperties: { type: 'string' },
        description: 'Environment overrides for the child process.',
        type: 'object',
      },
      max_output_bytes: { description: 'Maximum captured stdout and stderr bytes.', type: 'integer' },
      timeout_ms: { description: 'Kill the process after this duration.', type: 'integer' },
      yield_time_ms: { description: 'Return a process session if still running after this duration.', type: 'integer' },
      ...permissionProperties,
    },
    required: ['command'],
    type: 'object',
  },
})

export const createWriteStdinTool = (options: SandboxToolsOptions) => rawTool<WriteStdinToolInput>({
  description: 'Write to, poll, close, or terminate a persistent exec process session.',
  execute: async input => options.sandbox.writeProcess(input.session_id, {
    close: input.close,
    data: input.chars,
    ownerId: options.ownerId,
    terminate: input.terminate,
    yieldTimeMs: input.yield_time_ms,
  }),
  name: 'write_stdin',
  parameters: {
    additionalProperties: false,
    properties: {
      chars: { description: 'Characters to write. Omit to poll.', type: 'string' },
      close: { description: 'Close stdin after writing.', type: 'boolean' },
      session_id: { description: 'Session id returned by exec.', type: 'string' },
      terminate: { description: 'Terminate the process.', type: 'boolean' },
      yield_time_ms: { description: 'Wait this long for more output or completion.', type: 'integer' },
    },
    required: ['session_id'],
    type: 'object',
  },
})

export const createApplyPatchTool = (options: SandboxToolsOptions) => rawTool<ApplyPatchToolInput>({
  description: 'Apply a standard unified diff to the working tree with git apply inside the configured sandbox.',
  execute: async (input, executeOptions) => {
    const escalation = toEscalation(input)
    return options.sandbox.execute({
      command: 'git apply --recount --whitespace=nowarn -',
      cwd: input.cwd,
      escalation,
      input: input.patch,
      ownerId: options.ownerId,
      requestId: executeOptions.toolCallId,
      timeoutMs: input.timeout_ms,
    }, { signal: executeOptions.abortSignal })
  },
  name: 'apply_patch',
  parameters: {
    additionalProperties: false,
    properties: {
      cwd: { description: 'Base directory for patch paths.', type: 'string' },
      ...permissionProperties,
      patch: { description: 'A standard unified diff accepted by git apply.', type: 'string' },
      timeout_ms: { description: 'Kill git apply after this duration.', type: 'integer' },
    },
    required: ['patch'],
    type: 'object',
  },
})

export const createSandboxTools = (options: SandboxToolsOptions) => [
  createExecTool(options),
  createWriteStdinTool(options),
  createApplyPatchTool(options),
]

export const sandboxTools = (options: SandboxToolsOptions): AgentPlugin => ({
  extendTools: () => createSandboxTools(options),
  name: `${packageName}/tools`,
  stop: async () => options.sandbox.dispose(),
  version,
})
