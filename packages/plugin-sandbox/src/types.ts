export interface BackendStartOptions {
  command: string
  cwd: string
  env: Record<string, string | undefined>
  input?: string
  shell?: string
  signal?: AbortSignal
}

export interface CreateSandboxOptions {
  adapter: SandboxAdapter
  authorizeEscalation?: EscalationAuthorizer
  hostExecutor?: HostExecutor
  middleware?: SandboxMiddleware[]
  profile: SandboxProfile
}

export interface EscalationAuthorizationContext {
  createGrant: (options?: { expiresAt?: number }) => ExecutionGrant
  defaultProfile: Readonly<SandboxProfile>
  requestId: string
  signal?: AbortSignal
}

export type EscalationAuthorizer = (
  request: Readonly<ExecutionRequest & { escalation: EscalationRequest }>,
  context: EscalationAuthorizationContext,
) => Promise<ExecutionGrant | undefined>

export type EscalationRequest
  = | {
    justification: string
    permissions: PermissionDelta
    type: 'expand'
  }
  | {
    justification: string
    type: 'bypass'
  }

export interface ExecutionBackend {
  check: () => Promise<SandboxCapabilityReport>
  dispose?: () => Promise<void>
  readonly name: string
  start: (
    options: BackendStartOptions,
    profile: Readonly<SandboxProfile>,
    sink: ProcessSink,
  ) => Promise<RunningProcess>
}

export interface ExecutionExit {
  exitCode?: number
  signal?: NodeJS.Signals
}

export interface ExecutionGrant {
  readonly expiresAt: number
  readonly fingerprint: string
  readonly requestId: string
}

export interface ExecutionRequest {
  /** Shell command executed by the selected backend. */
  command: string
  cwd?: string
  env?: Record<string, string | undefined>
  escalation?: EscalationRequest
  /** Initial stdin written immediately after the process starts. */
  input?: string
  /** Maximum captured stdout + stderr bytes. Defaults to 10 MiB. */
  maxOutputBytes?: number
  /** Stable ownership boundary for persistent processes. */
  ownerId?: string
  requestId?: string
  shell?: string
  /** Kill the process after this duration. Defaults to 60 seconds. */
  timeoutMs?: number
  /** Return a session id if the process is still running after this duration. */
  yieldTimeMs?: number
}

export interface ExecutionResult extends ExecutionExit {
  durationMs: number
  requestId: string
  running: boolean
  sessionId?: string
  stderr: string
  stdout: string
  timedOut: boolean
  truncated: boolean
}

export interface FileSystemProfile {
  /** Re-open readable paths contained by a denied path. */
  allowRead: string[]
  /** Paths the sandboxed process may modify. */
  allowWrite: string[]
  /** Paths the sandboxed process may not read. */
  denyRead: string[]
  /** Read-only carve-outs contained by writable paths. */
  denyWrite: string[]
}

export interface HostExecutor extends ExecutionBackend {}

export interface NetworkProfile {
  /** Exact domains or supported wildcard domain patterns. Empty means no network. */
  allowedDomains: string[]
  allowLocalBinding: boolean
  allowUnixSockets: string[]
  /** Deny rules take precedence over allowed domains. */
  deniedDomains: string[]
}

export interface PermissionDelta {
  fileSystem?: {
    allowRead?: string[]
    allowWrite?: string[]
  }
  network?: {
    allowedDomains?: string[]
    allowLocalBinding?: boolean
    allowUnixSockets?: string[]
  }
}

export interface ProcessSink {
  stderr: (chunk: string | Uint8Array) => void
  stdout: (chunk: string | Uint8Array) => void
}
export interface RunningProcess {
  readonly completed: Promise<ExecutionExit>
  end: () => Promise<void>
  kill: (signal?: NodeJS.Signals) => void
  readonly pid?: number
  write: (data: string) => Promise<void>
}

export interface Sandbox {
  check: () => Promise<SandboxCapabilityReport>
  dispose: () => Promise<void>
  execute: (request: ExecutionRequest, options?: { signal?: AbortSignal }) => Promise<ExecutionResult>
  readonly profile: Readonly<SandboxProfile>
  writeProcess: (sessionId: string, options?: WriteProcessOptions) => Promise<ExecutionResult>
}

export interface SandboxAdapter extends ExecutionBackend {}

export interface SandboxCapabilityReport {
  errors: string[]
  platform: NodeJS.Platform
  supported: boolean
  warnings: string[]
}

export type SandboxMiddleware = (
  context: SandboxMiddlewareContext,
  next: () => Promise<ExecutionResult>,
) => Promise<ExecutionResult>

export interface SandboxMiddlewareContext {
  profile: Readonly<SandboxProfile>
  request: Readonly<ExecutionRequest>
  requestId: string
  route: SandboxRoute
}

export interface SandboxProfile {
  fileSystem: FileSystemProfile
  name: string
  network: NetworkProfile
  route: SandboxRoute
}

export type SandboxRoute = 'host' | 'sandbox'

export interface WriteProcessOptions {
  close?: boolean
  data?: string
  ownerId?: string
  terminate?: boolean
  yieldTimeMs?: number
}
