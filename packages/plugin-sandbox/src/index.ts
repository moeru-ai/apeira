import type { AgentPlugin } from '@apeira/core'

import type { CreateSandboxOptions } from './types'

import { name, version } from '../package.json'
import { createSandbox as createSandboxRuntime } from './sandbox'
import { createSandboxTools as createDefaultSandboxTools } from './tools/index'

export type SandboxPluginOptions = CreateSandboxOptions

export const sandbox = (options: SandboxPluginOptions): AgentPlugin => {
  const runtime = createSandboxRuntime(options)
  const tools = createDefaultSandboxTools({ sandbox: runtime })

  return {
    extendTools: () => tools,
    name,
    stop: async () => runtime.dispose(),
    version,
  }
}

export { createHostExecutor } from './process'
export {
  applyPermissionDelta,
  fullAccessProfile,
  readOnlyProfile,
  workspaceWriteProfile,
} from './profiles'
export { createExecutionGrant, createSandbox, SandboxError } from './sandbox'
export type { SandboxErrorCode } from './sandbox'
export {
  createApplyPatchTool,
  createExecTool,
  createSandboxTools,
  createWriteStdinTool,
  sandboxTools,
} from './tools/index'
export type {
  ApplyPatchToolInput,
  ExecToolInput,
  SandboxToolsOptions,
  WriteStdinToolInput,
} from './tools/index'
export type {
  BackendStartOptions,
  CreateSandboxOptions,
  EscalationAuthorizationContext,
  EscalationAuthorizer,
  EscalationRequest,
  ExecutionBackend,
  ExecutionExit,
  ExecutionGrant,
  ExecutionRequest,
  ExecutionResult,
  FileSystemProfile,
  HostExecutor,
  NetworkProfile,
  PermissionDelta,
  ProcessSink,
  RunningProcess,
  Sandbox,
  SandboxAdapter,
  SandboxCapabilityReport,
  SandboxMiddleware,
  SandboxMiddlewareContext,
  SandboxProfile,
  SandboxRoute,
  WriteProcessOptions,
} from './types'
