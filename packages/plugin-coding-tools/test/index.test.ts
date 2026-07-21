import type { AgentPlugin, Tool } from '@apeira/core'

import type { CodingToolsBackend, CodingToolsBackendContext, PermissionGrant } from '../src/types'

import process from 'node:process'

import { Buffer } from 'node:buffer'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { codingTools } from '../src/index'

const toolsFor = async (plugin: AgentPlugin, turnId = 'turn-1') =>
  await plugin.extendTools?.({ signal: new AbortController().signal, state: {}, turnId }) ?? []

const execute = async (tool: Tool, input: unknown, resolution?: unknown) => tool.execute(input, {
  approvalResolution: resolution,
  messages: [],
  toolCallId: 'call-1',
})

describe('codingTools', () => {
  it('registers the four Node tools without request_permissions', async () => {
    const tools = await toolsFor(codingTools())
    expect(tools.map(tool => tool.function.name)).toEqual([
      'apply_patch',
      'exec_command',
      'view_image',
      'write_stdin',
    ])
  })

  it('applies a standard Git patch relative to the plugin cwd', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'apeira-coding-tools-'))
    await writeFile(join(cwd, 'hello.txt'), 'hello\n')
    const tools = await toolsFor(codingTools({ cwd }))
    const tool = tools.find(tool => tool.function.name === 'apply_patch')!

    await expect(execute(tool, {
      patch: [
        'diff --git a/hello.txt b/hello.txt',
        'index ce01362..94954ab 100644',
        '--- a/hello.txt',
        '+++ b/hello.txt',
        '@@ -1 +1 @@',
        '-hello',
        '+world',
        '',
      ].join('\n'),
    })).resolves.toBe('Done!')
    await expect(readFile(join(cwd, 'hello.txt'), 'utf8')).resolves.toBe('world\n')
  })

  it('returns an interactive session and accepts later stdin', async () => {
    const tools = await toolsFor(codingTools())
    const exec = tools.find(tool => tool.function.name === 'exec_command')!
    const stdin = tools.find(tool => tool.function.name === 'write_stdin')!
    const command = `"${process.execPath}" -e "process.stdin.once('data', value => { process.stdout.write(value); process.exit(0) })"`
    const started = await execute(exec, { cmd: command, login: false, yield_time_ms: 250 }) as { session_id: number }

    expect(started.session_id).toBeTypeOf('number')
    await expect(execute(stdin, { chars: 'hello', session_id: started.session_id, yield_time_ms: 250 })).resolves.toMatchObject({
      exit_code: 0,
      output: 'hello',
    })
  })

  it('terminates retained sessions when the plugin stops', async () => {
    const plugin = codingTools()
    const tools = await toolsFor(plugin)
    const exec = tools.find(tool => tool.function.name === 'exec_command')!
    const stdin = tools.find(tool => tool.function.name === 'write_stdin')!
    const command = `"${process.execPath}" -e "setInterval(() => {}, 1000)"`
    const started = await execute(exec, { cmd: command, login: false, yield_time_ms: 250 }) as { session_id: number }

    await plugin.stop?.()
    await expect(execute(stdin, { session_id: started.session_id })).rejects.toThrow('Unknown or completed exec session')
  })

  it('rejects true PTY requests in the built-in backend', async () => {
    const tools = await toolsFor(codingTools())
    const exec = tools.find(tool => tool.function.name === 'exec_command')!
    await expect(execute(exec, { cmd: 'echo ignored', tty: true })).rejects.toThrow('PTY support')
  })

  it('returns supported images as high-detail multimodal content', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'apeira-coding-image-'))
    await writeFile(join(cwd, 'pixel.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    const tools = await toolsFor(codingTools({ cwd }))
    const view = tools.find(tool => tool.function.name === 'view_image')!

    const result = await execute(view, { detail: 'original', path: 'pixel.png' }) as Array<Record<string, unknown>>
    expect(result[0]).toMatchObject({ image_url: { detail: 'high' }, type: 'image_url' })
    expect((result[0]?.image_url as { url: string }).url).toMatch(/^data:image\/png;base64,/)
    expect(result[1]).toEqual({ text: '{"detail":"high"}', type: 'text' })
  })

  it('intersects structured grants and clears turn permissions', async () => {
    const contexts: unknown[] = []
    const requestPermissions = vi.fn(async (_input, context: CodingToolsBackendContext): Promise<PermissionGrant> => {
      contexts.push(context)
      return context.approvalResolution as PermissionGrant
    })
    const backend: CodingToolsBackend = {
      applyPatch: vi.fn(async (_input, context) => {
        contexts.push(context)
        return 'ok'
      }),
      execCommand: vi.fn(async () => ({ output: '', wall_time_seconds: 0 })),
      requestPermissions,
      viewImage: vi.fn(async () => ({ detail: 'high' as const, image_url: 'data:image/png;base64,AA==' })),
      writeStdin: vi.fn(async () => ({ output: '', wall_time_seconds: 0 })),
    }
    const plugin = codingTools({ backend, cwd: '/workspace' })
    const tools = await toolsFor(plugin)
    const request = tools.find(tool => tool.function.name === 'request_permissions')!
    const patch = tools.find(tool => tool.function.name === 'apply_patch')!

    await expect(execute(request, {
      permissions: { file_system: { write: ['/workspace'] }, network: { enabled: true } },
    }, {
      permissions: { file_system: { write: ['/workspace/sub', '/outside'] } },
      scope: 'turn',
    })).resolves.toEqual({
      permissions: { file_system: { write: ['/workspace/sub'] } },
      scope: 'turn',
    })

    await execute(patch, { patch: 'unused' })
    expect(contexts.at(-1)).toMatchObject({ permissions: { file_system: { write: ['/workspace/sub'] } } })

    await plugin.onTurnFinish?.({ input: [], output: [], turnId: 'turn-1' })
    const nextTools = await toolsFor(plugin, 'turn-2')
    await execute(nextTools.find(tool => tool.function.name === 'apply_patch')!, { patch: 'unused' })
    expect(contexts.at(-1)).toMatchObject({ permissions: {} })
  })
})
