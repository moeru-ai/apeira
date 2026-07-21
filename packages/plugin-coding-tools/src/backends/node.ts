import type { CommandWrapper } from '../process-manager'
import type { CodingToolsBackend, PermissionProfile, ViewImageOutput } from '../types'

import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { ProcessManager } from '../process-manager'

const MIME_SIGNATURES: Array<{ mime: string, test: (bytes: Uint8Array) => boolean }> = [
  {
    mime: 'image/png',
    test: bytes => [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value),
  },
  { mime: 'image/jpeg', test: bytes => bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF },
  { mime: 'image/gif', test: bytes => Buffer.from(bytes.subarray(0, 6)).toString('ascii').startsWith('GIF8') },
  { mime: 'image/webp', test: bytes => Buffer.from(bytes.subarray(0, 4)).toString('ascii') === 'RIFF' && Buffer.from(bytes.subarray(8, 12)).toString('ascii') === 'WEBP' },
]

export const imageDataUrl = (bytes: Uint8Array): ViewImageOutput => {
  const mime = MIME_SIGNATURES.find(candidate => candidate.test(bytes))?.mime
  if (mime == null)
    throw new Error('Unsupported image format. Expected PNG, JPEG, GIF, or WebP.')

  return {
    detail: 'high',
    image_url: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
  }
}

export interface ProcessBackendOptions {
  readImage?: (path: string, permissions: PermissionProfile, signal?: AbortSignal) => Promise<Uint8Array>
  wrapCommand?: CommandWrapper
}

export const createProcessBackend = (options: ProcessBackendOptions = {}): CodingToolsBackend => {
  const manager = new ProcessManager(options.wrapCommand)
  const readImage = options.readImage ?? (async path => readFile(path))

  return {
    applyPatch: async (input, context) => {
      const cwd = resolve(context.cwd, input.workdir ?? '.')
      const result = await manager.run('git apply --', {
        cwd,
        permissions: context.permissions,
        signal: context.signal,
      }, input.patch)
      if (result.exitCode !== 0)
        throw new Error(result.output.trim() || `git apply exited with code ${result.exitCode}`)
      return result.output.trim() || 'Done!'
    },
    execCommand: async (input, context) => manager.exec(input, {
      cwd: resolve(context.cwd, input.workdir ?? '.'),
      permissions: context.permissions,
      signal: context.signal,
    }),
    stop: async () => manager.stop(),
    viewImage: async (input, context) => imageDataUrl(await readImage(
      resolve(context.cwd, input.path),
      context.permissions,
      context.signal,
    )),
    writeStdin: async input => manager.write(input),
  }
}

export const nodeBackend = (): CodingToolsBackend => createProcessBackend()
