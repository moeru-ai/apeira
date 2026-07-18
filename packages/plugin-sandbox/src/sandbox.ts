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
  SandboxEvent,
  SandboxProfile,
  SandboxRoute,
} from './types'

import process from 'node:process'

import { Buffer } from 'node:buffer'

import { raceAbort, stableStringify } from '@apeira/internal-utils'

import { applyPermissionDelta, canonicalizePath } from './profiles'

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
const consumedGrants = new WeakSet<object>()

type AuthorizedExecutionRequest = ExecutionRequest & {
  escalation: EscalationRequest
  requestId: string
}

const executionFingerprint = (request: Readonly<AuthorizedExecutionRequest>) => stableStringify({
  command: request.command,
  cwd: request.cwd,
  env: request.env,
  escalation: request.escalation,
  input: request.input,
  maxOutputBytes: request.maxOutputBytes,
  ownerId: request.ownerId,
  requestId: request.requestId,
  shell: request.shell,
  timeoutMs: request.timeoutMs,
  yieldTimeMs: request.yieldTimeMs,
})

export const createExecutionGrant = (options: {
  expiresAt?: number
  request: Readonly<AuthorizedExecutionRequest>
}): ExecutionGrant => {
  const grant = {
    expiresAt: options.expiresAt ?? Date.now() + 60_000,
    fingerprint: executionFingerprint(options.request),
    requestId: options.request.requestId,
  }

  issuedGrants.add(grant)
  return grant
}

const isValidExecutionGrant = (
  grant: ExecutionGrant | undefined,
  request: Readonly<AuthorizedExecutionRequest>,
) => grant != null
  && issuedGrants.has(grant)
  && !consumedGrants.has(grant)
  && grant.requestId === request.requestId
  && grant.expiresAt >= Date.now()
  && grant.fingerprint === executionFingerprint(request)

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
  if (typeof request.command !== 'string' || request.command.trim().length === 0)
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
    ...structuredClone(request),
    cwd: canonicalizePath(request.cwd ?? process.cwd()),
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

const killProcess = (handle: RunningProcess, signal: NodeJS.Signals) => {
  try {
    handle.kill(signal)
  }
  catch {}
}

const terminateLateProcess = (handle: RunningProcess) => {
  killProcess(handle, 'SIGTERM')

  const forceKill = setTimeout(killProcess, FORCE_KILL_DELAY_MS, handle, 'SIGKILL')
  forceKill.unref?.()
  const clearForceKill = () => clearTimeout(forceKill)
  void handle.completed.then(clearForceKill, clearForceKill)
}

const scheduleForceKill = (session: ManagedProcess) => {
  if (session.forceKill != null)
    clearTimeout(session.forceKill)
  session.forceKill = setTimeout(killProcess, FORCE_KILL_DELAY_MS, session.handle, 'SIGKILL')
  session.forceKill.unref?.()
}

export const createSandbox = (options: CreateSandboxOptions): Sandbox => {
  const activeProcesses = new Set<ManagedProcess>()
  const inFlightStarts = new Set<Promise<ManagedProcess>>()
  const lifecycleController = new AbortController()
  const sessions = new Map<string, ManagedProcess>()
  const sandboxOwnerId = crypto.randomUUID()
  const defaultProfile = structuredClone(options.profile)
  let disposed = false

  const audit = (event: SandboxEvent) => {
    void Promise.resolve(options.audit?.(event)).catch(() => {})
  }

  const assertAvailable = () => {
    if (disposed)
      throw new SandboxError('disposed', 'Sandbox has been disposed.')
  }

  const resolveExecution = async (
    request: ExecutionRequest & { requestId: string },
    signal: AbortSignal,
  ): Promise<{ backend: ExecutionBackend, profile: Readonly<SandboxProfile>, route: SandboxRoute }> => {
    if (request.escalation != null)
      audit({ requestId: request.requestId, type: 'request' })
    if (request.escalation == null) {
      const route = defaultProfile.route
      if (route === 'host' && options.hostExecutor == null) {
        throw new SandboxError(
          'host_executor_unavailable',
          'The configured profile requires a HostExecutor, but none was provided.',
        )
      }
      return {
        backend: route === 'host' ? options.hostExecutor! : options.adapter,
        profile: defaultProfile,
        route,
      }
    }

    if (options.authorizeEscalation == null) {
      throw new SandboxError(
        'escalation_denied',
        'Execution requested additional permissions, but no escalation authorizer is configured.',
      )
    }

    const grant = await raceAbort(
      options.authorizeEscalation(request as ExecutionRequest & {
        escalation: NonNullable<ExecutionRequest['escalation']>
      }, {
        createGrant: grantOptions => createExecutionGrant({
          expiresAt: grantOptions?.expiresAt,
          request: request as AuthorizedExecutionRequest,
        }),
        defaultProfile,
        requestId: request.requestId,
        signal,
      }),
      signal,
    )

    if (grant == null) {
      throw new SandboxError(
        'escalation_denied',
        'The execution escalation request was denied.',
      )
    }
    if (!isValidExecutionGrant(grant, request as AuthorizedExecutionRequest)) {
      throw new SandboxError(
        'invalid_grant',
        'The escalation authorizer returned an invalid or expired grant.',
      )
    }
    consumedGrants.add(grant)

    if (request.escalation.type === 'bypass') {
      if (options.hostExecutor == null) {
        throw new SandboxError(
          'host_executor_unavailable',
          'Sandbox bypass was approved, but no HostExecutor is configured.',
        )
      }
      audit({ expiresAt: grant.expiresAt, requestId: request.requestId, route: 'host', type: 'grant' })
      return { backend: options.hostExecutor, profile: defaultProfile, route: 'host' }
    }

    audit({ expiresAt: grant.expiresAt, requestId: request.requestId, route: 'sandbox', type: 'grant' })
    return {
      backend: options.adapter,
      profile: applyPermissionDelta(defaultProfile, request.escalation.permissions, request.cwd),
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

  const startProcess = async (
    request: ExecutionRequest & { requestId: string },
    backend: ExecutionBackend,
    profile: Readonly<SandboxProfile>,
    signal: AbortSignal,
  ): Promise<ManagedProcess> => {
    if (signal.aborted)
      throw signal.reason ?? new SandboxError('aborted', 'Execution was aborted before it started.')

    const collector = new OutputCollector(request.maxOutputBytes!)
    let claimed = false
    let terminated = false
    const terminate = (handle: RunningProcess) => {
      if (terminated)
        return
      terminated = true
      terminateLateProcess(handle)
    }
    const starting = backend.start({
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
    void starting.then((handle) => {
      if (claimed || (!signal.aborted && !disposed))
        return
      terminate(handle)
    }, () => {})
    const handle = await raceAbort(starting, signal)
    claimed = true
    if (signal.aborted || disposed) {
      terminate(handle)
      throw signal.reason ?? new SandboxError('disposed', 'Sandbox was disposed while execution was starting.')
    }
    const session: ManagedProcess = {
      collector,
      completed: Promise.resolve(),
      handle,
      ownerId: request.ownerId ?? sandboxOwnerId,
      requestId: request.requestId,
      sessionId: crypto.randomUUID(),
      startedAt: Date.now(),
      timedOut: false,
    }

    const timeout = setTimeout(() => {
      session.timedOut = true
      killProcess(handle, 'SIGTERM')
      scheduleForceKill(session)
    }, request.timeoutMs)
    timeout.unref?.()

    const onAbort = () => {
      killProcess(handle, 'SIGTERM')
      scheduleForceKill(session)
    }
    session.completed = handle.completed.then(
      (exit) => {
        session.exit = exit
      },
      (error) => {
        session.error = error
      },
    ).finally(() => {
      clearTimeout(timeout)
      if (session.forceKill != null)
        clearTimeout(session.forceKill)
      signal.removeEventListener('abort', onAbort)
      activeProcesses.delete(session)
    })
    activeProcesses.add(session)
    if (signal.aborted)
      onAbort()
    else
      signal.addEventListener('abort', onAbort, { once: true })

    return session
  }

  const start = async (
    request: ExecutionRequest & { requestId: string },
    backend: ExecutionBackend,
    profile: Readonly<SandboxProfile>,
    signal: AbortSignal,
  ): Promise<ManagedProcess> => {
    const operation = startProcess(request, backend, profile, signal)
    inFlightStarts.add(operation)
    try {
      return await operation
    }
    finally {
      inFlightStarts.delete(operation)
    }
  }

  const executeRequest = async (
    rawRequest: ExecutionRequest,
    signal: AbortSignal,
  ): Promise<ExecutionResult> => {
    const request = normalizeRequest(rawRequest)
    const execution = await resolveExecution(request, signal)
    signal.throwIfAborted()
    try {
      audit({ backend: execution.backend.name, requestId: request.requestId, route: execution.route, type: 'execution' })
      const session = await start(
        request,
        execution.backend,
        execution.profile,
        signal,
      )
      const completed = await raceAbort(
        request.yieldTimeMs == null
          ? session.completed.then(() => true)
          : waitFor(session.completed, request.yieldTimeMs),
        signal,
      )

      if (completed) {
        if (session.error != null)
          throw session.error
        audit({ requestId: request.requestId, type: 'resolved' })
        return resultFor(session, false)
      }

      sessions.set(session.sessionId, session)
      return resultFor(session, true)
    }
    catch (error) {
      audit({
        code: error instanceof SandboxError ? error.code : 'execution_failed',
        requestId: request.requestId,
        type: 'failed',
      })
      if (signal.aborted) {
        audit({
          reason: signal.reason instanceof SandboxError && signal.reason.code === 'disposed' ? 'disposed' : 'aborted',
          requestId: request.requestId,
          type: 'cancelled',
        })
      }
      throw error
    }
  }

  const execute: Sandbox['execute'] = async (rawRequest, executeOptions = {}) => {
    assertAvailable()
    const signal = executeOptions.signal == null
      ? lifecycleController.signal
      : AbortSignal.any([lifecycleController.signal, executeOptions.signal])
    return executeRequest(rawRequest, signal)
  }

  const writeProcess: Sandbox['writeProcess'] = async (sessionId, writeOptions = {}) => {
    assertAvailable()
    const yieldTimeMs = writeOptions.yieldTimeMs ?? 250
    ensurePositiveInteger(yieldTimeMs, 'yieldTimeMs', true)
    const session = sessions.get(sessionId)
    if (session == null) {
      throw new SandboxError(
        'process_not_found',
        `No sandbox process session exists with id ${sessionId}.`,
      )
    }
    if (session.ownerId !== (writeOptions.ownerId ?? sandboxOwnerId)) {
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
      || await waitFor(session.completed, yieldTimeMs)
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
    lifecycleController.abort(new SandboxError('disposed', 'Sandbox has been disposed.'))
    const active = [...activeProcesses]
    activeProcesses.clear()
    sessions.clear()
    await Promise.allSettled(active.map(async session => session.completed))
    await Promise.allSettled([...inFlightStarts])
    await options.adapter.dispose?.()
    if (options.hostExecutor != null && options.hostExecutor !== options.adapter)
      await options.hostExecutor.dispose?.()
  }

  return {
    check: async () => {
      assertAvailable()
      const backend = defaultProfile.route === 'host' ? options.hostExecutor : options.adapter
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
    profile: defaultProfile,
    writeProcess,
  }
}
