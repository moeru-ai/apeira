import type { Tool } from '@apeira/core'

import type { SandboxManagerLike } from '../src/backends/sandbox'
import type { CodingToolsBackendContext } from '../src/types'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SandboxRuntimeConfigSchema } from '@anthropic-ai/sandbox-runtime'
import { describe, expect, it, vi } from 'vitest'

import { sandboxBackend } from '../src/backends/sandbox'
import { codingTools } from '../src/index'

const baseConfig = SandboxRuntimeConfigSchema.parse({
  filesystem: {
    allowRead: [],
    allowWrite: [],
    denyRead: [],
    denyWrite: [],
  },
  network: { allowedDomains: [], deniedDomains: [] },
})

const execute = async (tool: Tool, input: unknown, approvalResolution?: unknown) => tool.execute(input, {
  approvalResolution,
  messages: [],
  toolCallId: 'call-1',
})

describe('sandboxBackend', () => {
  it.runIf(process.platform !== 'win32')('wraps image reads and merges turn grants into per-command config', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'apeira-coding-sandbox-'))
    await writeFile(join(cwd, 'pixel.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const wrapWithSandboxArgv = vi.fn(async (...args: Parameters<SandboxManagerLike['wrapWithSandboxArgv']>) => ({
      argv: ['/bin/sh', '-c', args[0]],
      env: process.env,
    }))
    const manager: SandboxManagerLike = {
      getConfig: () => baseConfig,
      isSandboxingEnabled: () => true,
      wrapWithSandboxArgv,
    }
    const plugin = codingTools({ backend: sandboxBackend({ manager }), cwd })
    const tools = await plugin.extendTools?.({ state: {}, turnId: 'turn-1' }) ?? []
    const request = tools.find(tool => tool.function.name === 'request_permissions')!
    const view = tools.find(tool => tool.function.name === 'view_image')!

    await execute(request, { permissions: { file_system: { read: [cwd] }, network: { enabled: true } } })
    const result = await execute(view, { path: 'pixel.png' })

    expect((result as Array<Record<string, unknown>>)[0]).toMatchObject({ image_url: { detail: 'high' }, type: 'image_url' })
    expect(wrapWithSandboxArgv).toHaveBeenCalled()
    const customConfig = wrapWithSandboxArgv.mock.calls.at(-1)?.[2]
    expect(customConfig?.filesystem?.allowRead).toContain(cwd)
    expect(customConfig?.network?.allowedDomains).toContain('*')
  })

  it('fails clearly when the manager has not been initialized', async () => {
    const manager: SandboxManagerLike = {
      getConfig: () => undefined,
      isSandboxingEnabled: () => false,
      wrapWithSandboxArgv: vi.fn(),
    }
    const plugin = codingTools({ backend: sandboxBackend({ manager }) })
    const tools = await plugin.extendTools?.({ state: {}, turnId: 'turn-1' }) ?? []
    const exec = tools.find(tool => tool.function.name === 'exec_command')!

    await expect(execute(exec, { cmd: 'echo no' })).rejects.toThrow('must be initialized and enabled')
  })

  it('rejects dynamic filesystem grants on Windows', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const backend = sandboxBackend()
    const context: CodingToolsBackendContext = {
      cwd: 'C:\\workspace',
      permissions: {},
      toolCallId: 'call-1',
      turnId: 'turn-1',
    }

    try {
      await expect(Promise.resolve().then(async () => backend.requestPermissions?.({
        permissions: { file_system: { write: ['C:\\workspace'] } },
      }, context))).rejects.toThrow('not supported by Sandbox Runtime on Windows')
    }
    finally {
      platform.mockRestore()
    }
  })
})
