import type {
  CreateSandboxOptions,
  EscalationRequest,
  ExecutionBackend,
  ExecutionExit,
  ExecutionGrant,
  ExecutionRequest,
  ExecutionResult,
  RunningProcess,
  Sandbox,
  SandboxMiddleware,
  SandboxMiddlewareContext,
  SandboxProfile,
  SandboxRoute,
} from './types'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { resolve } from 'node:path'

import { applyPermissionDelta } from './profiles'

export type SandboxErrorCode
  = | 'aborted'
    | 'adapter_unavailable'
    | 'disposed'
    | 'escalation_denied'
    | 'host_executor_unavailable'
    | 'invalid_grant'
    | 'invalid_request'
    | 'process_not_found'
    | 'process_owner_mismatch'

export class SandboxError extends Error {
  readonly code: SandboxErrorCode
  readonly details?: Record<string, unknown>

  constructor(code: SandboxErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.code = code
    this.details = details
    this.name = 'SandboxError'
  }
}

const issuedGrants = new WeakSet<object>()

const stable = (value: unknown): string => {
  if (Array.isArray(value))
    return `[${value.map(stable).join(',')}]`

  if (value != null && typeof value === 'object') {
    const entries = Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(',')
    return `{${entries}}`
  }

  return JSON.stringify(value)
}

const escalationFingerprint = (escalation: Readonly<EscalationRequest>) => stable(escalation)

export const createExecutionGrant = (options: {
  escalation: Readonly<EscalationRequest>
  expiresAt?: number
  requestId: string
}): ExecutionGrant => {
  const grant = Object.freeze({
    expiresAt: options.expiresAt ?? Date.now() + 60_000,
    fingerprint: escalationFingerprint(options.escalation),
    requestId: options.requestId,
  })

  issuedGrants.add(grant)
  return grant
}

const isValidExecutionGrant = (
  grant: ExecutionGrant | undefined,
  requestId: string,
  escalation: Readonly<EscalationRequest>,
) => grant != null
  && issuedGrants.has(grant)
  && grant.requestId === requestId
  && grant.expiresAt >= Date.now()
  && grant.fingerprint === escalationFingerprint(escalation)

const appendWithinLimit = (
  current: Buffer,
  chunk: string | Uint8Array,
  available: number,
): { buffer: Buffer, truncated: boolean } => {
  const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

  if (available === 0)
    return { buffer: current, truncated: incoming.byteLength > 0 }
  if (incoming.byteLength <= available)
    return { buffer: Buffer.concat([current, incoming]), truncated: false }
  return {
    buffer: Buffer.concat([current, incoming.subarray(0, available)]),
    truncated: true,
  }
}

class OutputCollector {
  #stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  #stderrOffset = 0
  #stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
  #stdoutOffset = 0
  #truncated = false
  private readonly limit: number

  constructor(limit: number) {
    this.limit = limit
  }

  appendStderr(chunk: string | Uint8Array) {
    const result = appendWithinLimit(this.#stderr, chunk, this.remaining())
    this.#stderr = result.buffer
    this.#truncated ||= result.truncated
  }

  appendStdout(chunk: string | Uint8Array) {
    const result = appendWithinLimit(this.#stdout, chunk, this.remaining())
    this.#stdout = result.buffer
    this.#truncated ||= result.truncated
  }

  read() {
    const stderr = this.#stderr.subarray(this.#stderrOffset).toString('utf8')
    const stdout = this.#stdout.subarray(this.#stdoutOffset).toString('utf8')
    this.#stderrOffset = this.#stderr.byteLength
    this.#stdoutOffset = this.#stdout.byteLength
    return { stderr, stdout, truncated: this.#truncated }
  }

  private remaining() {
    return Math.max(0, this.limit - this.#stderr.byteLength - this.#stdout.byteLength)
  }
}

const DEFAULT_MAX_OUTPUT_BYTES = 10 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60_000
const FORCE_KILL_DELAY_MS = 1_000

interface ManagedProcess {
  collector: OutputCollector
  completed: Promise<void>
  error?: unknown
  exit?: ExecutionExit
  forceKill?: NodeJS.Timeout
  handle: RunningProcess
  ownerId?: string
  requestId: string
  sessionId: string
  startedAt: number
  timedOut: boolean
}

const ensurePositiveInteger = (value: number, name: string, allowZero = false) => {
  if (Number.isInteger(value) && value >= (allowZero ? 0 : 1))
    return
  throw new SandboxError(
    'invalid_request',
    `${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer.`,
  )
}

const normalizeRequest = (request: ExecutionRequest): ExecutionRequest & { requestId: string } => {
  if (request.command.trim().length === 0)
    throw new SandboxError('invalid_request', 'Execution command cannot be empty.')

  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  ensurePositiveInteger(timeoutMs, 'timeoutMs')
  ensurePositiveInteger(maxOutputBytes, 'maxOutputBytes')
  if (request.yieldTimeMs != null)
    ensurePositiveInteger(request.yieldTimeMs, 'yieldTimeMs', true)
  if (request.escalation != null && request.escalation.justification.trim().length === 0) {
    throw new SandboxError(
      'invalid_request',
      'Escalation requests require a non-empty justification.',
    )
  }

  return {
    ...request,
    cwd: resolve(request.cwd ?? process.cwd()),
    maxOutputBytes,
    requestId: request.requestId ?? crypto.randomUUID(),
    timeoutMs,
  }
}

const waitFor = async (promise: Promise<unknown>, timeoutMs: number): Promise<boolean> => {
  if (timeoutMs === 0)
    return false

  let timer: NodeJS.Timeout | undefined
  const completed = await Promise.race([
    promise.then(() => true),
    new Promise<false>((resolveTimeout) => {
      timer = setTimeout(resolveTimeout, timeoutMs, false)
      timer.unref?.()
    }),
  ])
  if (timer != null)
    clearTimeout(timer)
  return completed
}

const runMiddleware = async (
  middleware: readonly SandboxMiddleware[],
  context: SandboxMiddlewareContext,
  dispatch: () => Promise<ExecutionResult>,
) => {
  const invoke = async (index: number): Promise<ExecutionResult> => {
    const current = middleware[index]
    if (current == null)
      return dispatch()

    let called = false
    return current(context, async () => {
      if (called)
        throw new SandboxError('invalid_request', 'Sandbox middleware called next() more than once.')
      called = true
      return invoke(index + 1)
    })
  }

  return invoke(0)
}

export const createSandbox = (options: CreateSandboxOptions): Sandbox => {
  const activeProcesses = new Set<ManagedProcess>()
  const sessions = new Map<string, ManagedProcess>()
  let disposed = false

  const assertAvailable = () => {
    if (disposed)
      throw new SandboxError('disposed', 'Sandbox has been disposed.')
  }

  const resolveExecution = async (
    request: ExecutionRequest & { requestId: string },
  ): Promise<{ backend: ExecutionBackend, profile: SandboxProfile, route: SandboxRoute }> => {
    if (request.escalation == null) {
      const route = options.profile.route
      if (route === 'host' && options.hostExecutor == null) {
        throw new SandboxError(
          'host_executor_unavailable',
          'The configured profile requires a HostExecutor, but none was provided.',
        )
      }
      return {
        backend: route === 'host' ? options.hostExecutor! : options.adapter,
        profile: options.profile,
        route,
      }
    }

    if (options.authorizeEscalation == null) {
      throw new SandboxError(
        'escalation_denied',
        'Execution requested additional permissions, but no escalation authorizer is configured.',
      )
    }

    const grant = await options.authorizeEscalation(request as ExecutionRequest & {
      escalation: NonNullable<ExecutionRequest['escalation']>
    }, {
      defaultProfile: options.profile,
      requestId: request.requestId,
    })

    if (grant == null) {
      throw new SandboxError(
        'escalation_denied',
        'The execution escalation request was denied.',
      )
    }
    if (!isValidExecutionGrant(grant, request.requestId, request.escalation)) {
      throw new SandboxError(
        'invalid_grant',
        'The escalation authorizer returned an invalid or expired grant.',
      )
    }

    if (request.escalation.kind === 'bypass') {
      if (options.hostExecutor == null) {
        throw new SandboxError(
          'host_executor_unavailable',
          'Sandbox bypass was approved, but no HostExecutor is configured.',
        )
      }
      return { backend: options.hostExecutor, profile: options.profile, route: 'host' }
    }

    return {
      backend: options.adapter,
      profile: applyPermissionDelta(options.profile, request.escalation.permissions, request.cwd),
      route: 'sandbox',
    }
  }

  const resultFor = (session: ManagedProcess, running: boolean): ExecutionResult => {
    const output = session.collector.read()
    return {
      ...session.exit,
      durationMs: Date.now() - session.startedAt,
      requestId: session.requestId,
      running,
      sessionId: running ? session.sessionId : undefined,
      stderr: output.stderr,
      stdout: output.stdout,
      timedOut: session.timedOut,
      truncated: output.truncated,
    }
  }

  const start = async (
    request: ExecutionRequest & { requestId: string },
    backend: ExecutionBackend,
    profile: Readonly<SandboxProfile>,
    signal?: AbortSignal,
  ): Promise<ManagedProcess> => {
    if (signal?.aborted)
      throw signal.reason ?? new SandboxError('aborted', 'Execution was aborted before it started.')

    const collector = new OutputCollector(request.maxOutputBytes!)
    const handle = await backend.start({
      command: request.command,
      cwd: request.cwd!,
      env: request.env ?? {},
      input: request.input,
      shell: request.shell,
      signal,
    }, profile, {
      stderr: chunk => collector.appendStderr(chunk),
      stdout: chunk => collector.appendStdout(chunk),
    })
    const session: ManagedProcess = {
      collector,
      completed: Promise.resolve(),
      handle,
      ownerId: request.ownerId,
      requestId: request.requestId,
      sessionId: crypto.randomUUID(),
      startedAt: Date.now(),
      timedOut: false,
    }

    const timeout = setTimeout(() => {
      session.timedOut = true
      handle.kill('SIGTERM')
      session.forceKill = setTimeout(() => handle.kill('SIGKILL'), FORCE_KILL_DELAY_MS)
      session.forceKill.unref?.()
    }, request.timeoutMs)
    timeout.unref?.()

    session.completed = handle.completed.then((exit) => {
      session.exit = exit
      clearTimeout(timeout)
      if (session.forceKill != null)
        clearTimeout(session.forceKill)
      activeProcesses.delete(session)
    }, (error) => {
      session.error = error
      clearTimeout(timeout)
      if (session.forceKill != null)
        clearTimeout(session.forceKill)
      activeProcesses.delete(session)
    })
    activeProcesses.add(session)

    if (disposed) {
      handle.kill('SIGTERM')
      await session.completed
      throw new SandboxError('disposed', 'Sandbox was disposed while execution was starting.')
    }

    return session
  }

  const execute: Sandbox['execute'] = async (rawRequest, executeOptions = {}) => {
    assertAvailable()
    const request = normalizeRequest(rawRequest)
    const execution = await resolveExecution(request)
    const context: SandboxMiddlewareContext = {
      profile: execution.profile,
      request,
      requestId: request.requestId,
      route: execution.route,
    }

    return runMiddleware(options.middleware ?? [], context, async () => {
      const session = await start(
        request,
        execution.backend,
        execution.profile,
        executeOptions.signal,
      )
      const completed = request.yieldTimeMs == null
        ? (await session.completed.then(() => true))
        : await waitFor(session.completed, request.yieldTimeMs)

      if (executeOptions.signal?.aborted)
        throw executeOptions.signal.reason ?? new SandboxError('aborted', 'Execution was aborted.')

      if (completed) {
        if (session.error != null)
          throw session.error
        return resultFor(session, false)
      }

      sessions.set(session.sessionId, session)
      return resultFor(session, true)
    })
  }

  const writeProcess: Sandbox['writeProcess'] = async (sessionId, writeOptions = {}) => {
    assertAvailable()
    const session = sessions.get(sessionId)
    if (session == null) {
      throw new SandboxError(
        'process_not_found',
        `No sandbox process session exists with id ${sessionId}.`,
      )
    }
    if (session.ownerId != null && session.ownerId !== writeOptions.ownerId) {
      throw new SandboxError(
        'process_owner_mismatch',
        'The process session belongs to a different owner.',
      )
    }

    if (writeOptions.terminate) {
      session.handle.kill('SIGTERM')
    }
    else {
      if (writeOptions.data != null)
        await session.handle.write(writeOptions.data)
      if (writeOptions.close)
        await session.handle.end()
    }

    const completed = session.exit != null
      || await waitFor(session.completed, writeOptions.yieldTimeMs ?? 250)
    if (completed) {
      await session.completed
      sessions.delete(sessionId)
      if (session.error != null)
        throw session.error
    }
    return resultFor(session, !completed)
  }

  const dispose: Sandbox['dispose'] = async () => {
    if (disposed)
      return
    disposed = true
    const active = [...activeProcesses]
    activeProcesses.clear()
    sessions.clear()
    for (const session of active)
      session.handle.kill('SIGTERM')
    await Promise.allSettled(active.map(async session => session.completed))
    await options.adapter.dispose?.()
    if (options.hostExecutor != null && options.hostExecutor !== options.adapter)
      await options.hostExecutor.dispose?.()
  }

  return {
    check: async () => {
      assertAvailable()
      const backend = options.profile.route === 'host' ? options.hostExecutor : options.adapter
      if (backend == null) {
        return {
          errors: ['The configured profile requires a HostExecutor, but none was provided.'],
          platform: process.platform,
          supported: false,
          warnings: [],
        }
      }
      return backend.check()
    },
    dispose,
    execute,
    profile: options.profile,
    writeProcess,
  }
}
