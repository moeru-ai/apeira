import type { SandboxRuntimeConfig } from '@anthropic-ai/sandbox-runtime'

import type { CommandWrapper } from '../process-manager'
import type { CodingToolsBackend, PermissionProfile } from '../types'

import process from 'node:process'

import { Buffer } from 'node:buffer'

import { SandboxManager } from '@anthropic-ai/sandbox-runtime'

import { permissionGrantFromResolution } from '../permissions'
import { ProcessManager } from '../process-manager'
import { createProcessBackend } from './node'

export interface SandboxBackendOptions {
  manager?: SandboxManagerLike
}

export interface SandboxManagerLike {
  getConfig: typeof SandboxManager.getConfig
  isSandboxingEnabled: typeof SandboxManager.isSandboxingEnabled
  wrapWithSandboxArgv: typeof SandboxManager.wrapWithSandboxArgv
}

const unique = (items: string[]) => [...new Set(items)]

const configForPermissions = (
  manager: SandboxManagerLike,
  permissions: PermissionProfile,
): Partial<SandboxRuntimeConfig> => {
  const base = manager.getConfig()
  if (base == null || !manager.isSandboxingEnabled())
    throw new Error('SandboxManager must be initialized and enabled before using sandboxBackend().')

  const read = permissions.file_system?.read ?? []
  const write = permissions.file_system?.write ?? []
  if (process.platform === 'win32' && (read.length > 0 || write.length > 0)) {
    throw new Error(
      'Dynamic filesystem permissions are not supported by Sandbox Runtime on Windows. Configure filesystem access during SandboxManager.initialize().',
    )
  }

  return {
    ...(process.platform === 'win32'
      ? {}
      : {
          filesystem: {
            ...base.filesystem,
            allowRead: unique([...(base.filesystem.allowRead ?? []), ...read]),
            allowWrite: unique([...(base.filesystem.allowWrite ?? []), ...write]),
          },
        }),
    ...(permissions.network?.enabled === true
      ? {
          network: {
            ...base.network,
            allowedDomains: unique([...(base.network.allowedDomains ?? []), '*']),
          },
        }
      : {}),
  }
}

const quotePosix = (value: string) => `'${value.replaceAll('\'', '\'\\\'\'')}'`

const quoteWindows = (value: string) => JSON.stringify(value)

const quoteArgument = (value: string) => process.platform === 'win32'
  ? quoteWindows(value)
  : quotePosix(value)

const IMAGE_READER_SCRIPT = `
const { readFile } = require('node:fs/promises');
readFile(process.argv[1]).then(
  value => process.stdout.write(value.toString('base64')),
  error => { console.error(error.message); process.exitCode = 1; },
);
`.trim()

export const sandboxBackend = (options: SandboxBackendOptions = {}): CodingToolsBackend => {
  const manager = options.manager ?? SandboxManager
  const wrapCommand: CommandWrapper = async ({ command, cwd, login, permissions, shell, signal }) => {
    const useLoginShell = process.platform !== 'win32' && login !== false
    const sandboxCommand = useLoginShell
      ? `${quotePosix(shell ?? process.env.SHELL ?? '/bin/sh')} -lc ${quotePosix(command)}`
      : command
    const descriptor = await manager.wrapWithSandboxArgv(
      sandboxCommand,
      useLoginShell ? undefined : shell,
      configForPermissions(manager, permissions),
      signal,
      cwd,
    )
    return { argv: descriptor.argv, env: descriptor.env }
  }
  const imageManager = new ProcessManager(wrapCommand)
  const backend = createProcessBackend({
    readImage: async (path, permissions, signal) => {
      const encodedScript = Buffer.from(IMAGE_READER_SCRIPT).toString('base64')
      const bootstrap = `eval(Buffer.from('${encodedScript}','base64').toString())`
      const command = [process.execPath, '-e', bootstrap, path].map(quoteArgument).join(' ')
      const result = await imageManager.run(command, {
        cwd: process.cwd(),
        login: false,
        permissions,
        signal,
      })
      if (result.exitCode !== 0)
        throw new Error(result.output.trim() || `Sandboxed image read exited with code ${result.exitCode}`)
      return Buffer.from(result.output.trim(), 'base64')
    },
    wrapCommand,
  })

  return {
    ...backend,
    requestPermissions: (input, context) => {
      const grant = permissionGrantFromResolution(context.approvalResolution, input.permissions)
      if (process.platform === 'win32') {
        const read = grant.permissions.file_system?.read ?? []
        const write = grant.permissions.file_system?.write ?? []
        if (read.length > 0 || write.length > 0) {
          throw new Error(
            'Dynamic filesystem permissions are not supported by Sandbox Runtime on Windows. Configure filesystem access during SandboxManager.initialize().',
          )
        }
      }
      return grant
    },
    stop: async () => {
      await Promise.all([backend.stop?.(), imageManager.stop()])
    },
  }
}
