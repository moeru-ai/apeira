import type {
  EscalationAuthorizer,
  ExecutionBackend,
  ExecutionRequest,
  RunningProcess,
  Sandbox,
  SandboxProfile,
} from '../src'

import { resolve } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createExecutionGrant,
  createHostExecutor,
  createSandbox,
  readOnlyProfile,
  SandboxError,
} from '../src'

const completedProcess = (): RunningProcess => ({
  completed: Promise.resolve({ exitCode: 0 }),
  end: async () => {},
  kill: () => {},
  write: async () => {},
})

const host = createHostExecutor()
const sandboxes: Sandbox[] = []

const trackedSandbox = (options: Parameters<typeof createSandbox>[0]) => {
  const sandbox = createSandbox(options)
  sandboxes.push(sandbox)
  return sandbox
}

afterEach(async () => {
  await Promise.all(sandboxes.splice(0).map(async sandbox => sandbox.dispose()))
})

describe('createSandbox', () => {
  it('rejects a missing execution command', async () => {
    const sandbox = trackedSandbox({ adapter: host, profile: readOnlyProfile() })

    await expect(sandbox.execute({} as ExecutionRequest))
      .rejects
      .toMatchObject({ code: 'invalid_request' })
  })

  it('captures stdout and stderr from the sandbox backend', async () => {
    const sandbox = trackedSandbox({ adapter: host, profile: readOnlyProfile() })
    const result = await sandbox.execute({
      command: 'printf \'out\\n\'; printf \'err\\n\' >&2',
    })

    expect(result).toMatchObject({
      exitCode: 0,
      running: false,
      stderr: 'err\n',
      stdout: 'out\n',
      timedOut: false,
      truncated: false,
    })
  })

  it('truncates combined output at the configured byte limit', async () => {
    const sandbox = trackedSandbox({ adapter: host, profile: readOnlyProfile() })
    const result = await sandbox.execute({ command: 'printf \'1234567890\'', maxOutputBytes: 4 })

    expect(result.stdout).toBe('1234')
    expect(result.truncated).toBe(true)
  })

  it('returns and polls an owned persistent process session', async () => {
    const sandbox = trackedSandbox({ adapter: host, profile: readOnlyProfile() })
    const started = await sandbox.execute({
      command: 'read value; printf \'got:%s\\n\' "$value"',
      ownerId: 'agent-a',
      yieldTimeMs: 0,
    })

    expect(started.running).toBe(true)
    await expect(sandbox.writeProcess(started.sessionId!, { ownerId: 'agent-b' }))
      .rejects
      .toMatchObject({ code: 'process_owner_mismatch' })
    await expect(sandbox.writeProcess(started.sessionId!, { yieldTimeMs: -1 }))
      .rejects
      .toMatchObject({ code: 'invalid_request' })

    const finished = await sandbox.writeProcess(started.sessionId!, {
      data: 'done\n',
      ownerId: 'agent-a',
      yieldTimeMs: 500,
    })
    expect(finished).toMatchObject({ exitCode: 0, running: false, stdout: 'got:done\n' })
  })

  it('marks timed-out commands and terminates them', async () => {
    const sandbox = trackedSandbox({ adapter: host, profile: readOnlyProfile() })
    const result = await sandbox.execute({
      command: 'while :; do :; done',
      timeoutMs: 30,
    })

    expect(result.running).toBe(false)
    expect(result.timedOut).toBe(true)
    expect(result.signal).toBe('SIGTERM')
  })

  it('force kills processes that ignore SIGTERM during disposal', async () => {
    vi.useFakeTimers()
    try {
      const signals: Array<NodeJS.Signals | undefined> = []
      let finish: (exit: { signal?: NodeJS.Signals }) => void = _exit => undefined
      const completed = new Promise<{ signal?: NodeJS.Signals }>((resolveCompleted) => {
        finish = resolveCompleted
      })
      const adapter: ExecutionBackend = {
        check: async () => ({ errors: [], platform: process.platform, supported: true, warnings: [] }),
        name: 'stubborn',
        start: async () => ({
          completed,
          end: async () => {},
          kill: (signal) => {
            signals.push(signal)
            if (signal === 'SIGKILL')
              finish({ signal })
          },
          write: async () => {},
        }),
      }
      const sandbox = trackedSandbox({ adapter, profile: readOnlyProfile() })
      await sandbox.execute({ command: 'wait forever', yieldTimeMs: 0 })

      const disposing = sandbox.dispose()
      await vi.advanceTimersByTimeAsync(1_000)
      await disposing

      expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('fails closed when escalation has no authorizer', async () => {
    const sandbox = trackedSandbox({ adapter: host, profile: readOnlyProfile() })

    await expect(sandbox.execute({
      command: 'true',
      escalation: { justification: 'write a generated file', permissions: {}, type: 'expand' },
    })).rejects.toMatchObject({ code: 'escalation_denied' })
  })

  it('applies only a grant minted for the exact escalation request', async () => {
    let authorizationCalls = 0
    let observedProfile: Readonly<SandboxProfile> | undefined
    const adapter: ExecutionBackend = {
      check: async () => ({ errors: [], platform: process.platform, supported: true, warnings: [] }),
      name: 'recording',
      start: async (_request, profile) => {
        observedProfile = profile
        return completedProcess()
      },
    }
    const authorizeEscalation: EscalationAuthorizer = async (_request, context) => {
      authorizationCalls += 1
      return context.createGrant()
    }
    const sandbox = trackedSandbox({
      adapter,
      authorizeEscalation,
      profile: readOnlyProfile(),
    })

    await sandbox.execute({
      command: 'true',
      cwd: '/workspace/project',
      escalation: {
        justification: 'read generated fixtures',
        permissions: { fileSystem: { allowRead: ['fixtures'] } },
        type: 'expand',
      },
      requestId: 'request-1',
    })

    expect(authorizationCalls).toBe(1)
    expect(observedProfile?.fileSystem.allowRead).toEqual([resolve('/workspace/project/fixtures')])
  })

  it('requires a host executor for an approved bypass', async () => {
    const sandbox = trackedSandbox({
      adapter: host,
      authorizeEscalation: async (request, context) => createExecutionGrant({
        escalation: request.escalation,
        requestId: context.requestId,
      }),
      profile: readOnlyProfile(),
    })

    await expect(sandbox.execute({
      command: 'true',
      escalation: { justification: 'run an unsupported operation', type: 'bypass' },
    })).rejects.toEqual(expect.objectContaining({
      code: 'host_executor_unavailable',
      name: SandboxError.name,
    }))
  })

  it('rejects a grant minted for a different escalation', async () => {
    const sandbox = trackedSandbox({
      adapter: host,
      authorizeEscalation: async (_request, context) => createExecutionGrant({
        escalation: { justification: 'different request', type: 'bypass' },
        requestId: context.requestId,
      }),
      profile: readOnlyProfile(),
    })

    await expect(sandbox.execute({
      command: 'true',
      escalation: {
        justification: 'read one path',
        permissions: { fileSystem: { allowRead: ['/example/read-only'] } },
        type: 'expand',
      },
    })).rejects.toMatchObject({ code: 'invalid_grant' })
  })
})
