import type { RunningProcess } from '../src'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  createSandbox,
  readOnlyProfile,
} from '../src'
import { createSrtAdapter } from '../src/srt/index'

const mocks = vi.hoisted(() => ({
  cleanupAfterCommand: vi.fn(),
  initialize: vi.fn(async () => {}),
  reset: vi.fn(async () => {}),
  startNodeProcess: vi.fn((): RunningProcess => ({
    completed: Promise.resolve({ exitCode: 0 }),
    end: async () => {},
    kill: () => {},
    write: async () => {},
  })),
  wrapWithSandboxArgv: vi.fn(async () => ({ argv: ['/bin/sh', '-lc', 'true'], env: {} })),
}))

vi.mock('@anthropic-ai/sandbox-runtime', () => ({
  SandboxManager: {
    checkDependencies: () => ({ errors: [], warnings: [] }),
    cleanupAfterCommand: mocks.cleanupAfterCommand,
    initialize: mocks.initialize,
    reset: mocks.reset,
    wrapWithSandboxArgv: mocks.wrapWithSandboxArgv,
  },
  SandboxRuntimeConfigSchema: { parse: (config: unknown) => config },
}))

vi.mock('../src/process', () => ({
  startNodeProcess: mocks.startNodeProcess,
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('createSrtAdapter', () => {
  it('rejects a temporary network expansion without changing its configured baseline', async () => {
    const profile = readOnlyProfile()
    const adapter = createSrtAdapter({ networkProfile: profile.network })
    const sandbox = createSandbox({
      adapter,
      authorizeEscalation: async (_request, context) => context.createGrant(),
      profile,
    })

    try {
      await expect(sandbox.execute({
        command: 'true',
        escalation: {
          justification: 'access example.com',
          permissions: { network: { allowedDomains: ['example.com'] } },
          type: 'expand',
        },
      })).rejects.toMatchObject({ code: 'adapter_unavailable' })
      expect(mocks.initialize).not.toHaveBeenCalled()

      await expect(sandbox.execute({ command: 'true' }))
        .resolves
        .toMatchObject({ exitCode: 0 })
      expect(mocks.initialize).toHaveBeenCalledOnce()
    }
    finally {
      await sandbox.dispose()
    }
  })
})
