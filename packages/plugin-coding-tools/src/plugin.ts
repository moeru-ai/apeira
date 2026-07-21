import type { AgentPlugin } from '@apeira/core'

import type {
  ApprovalAwareToolExecuteOptions,
  CodingToolsBackend,
  CodingToolsBackendContext,
  PermissionProfile,
} from './types'

import process from 'node:process'

import { resolve } from 'node:path'

import { tool } from '@apeira/core'

import { name, version } from '../package.json'
import { nodeBackend } from './backends/node'
import { intersectPermissionGrant, mergePermissionProfiles } from './permissions'
import {
  applyPatchSchema,
  execCommandSchema,
  requestPermissionsSchema,
  viewImageSchema,
  writeStdinSchema,
} from './schemas'

export interface CodingToolsOptions {
  backend?: CodingToolsBackend
  cwd?: string
}

export const codingTools = (options: CodingToolsOptions = {}): AgentPlugin => {
  const backend = options.backend ?? nodeBackend()
  const cwd = resolve(options.cwd ?? process.cwd())
  const turnPermissions = new Map<string, PermissionProfile>()
  let sessionPermissions: PermissionProfile = {}

  const permissionsFor = (turnId: string) => mergePermissionProfiles(
    sessionPermissions,
    turnPermissions.get(turnId) ?? {},
  )

  const contextFor = (
    turnId: string,
    executeOptions: ApprovalAwareToolExecuteOptions,
  ): CodingToolsBackendContext => ({
    approvalResolution: executeOptions.approvalResolution,
    cwd,
    permissions: permissionsFor(turnId),
    signal: executeOptions.abortSignal,
    toolCallId: executeOptions.toolCallId,
    turnId,
  })

  return {
    extendTools: ({ turnId }) => {
      const tools = [
        tool({
          description: 'Apply a standard Git patch atomically with git apply.',
          execute: async (input, executeOptions) => backend.applyPatch(input, contextFor(turnId, executeOptions)),
          name: 'apply_patch',
          parameters: applyPatchSchema,
        }),
        tool({
          description: 'Run a shell command, returning output or a session ID for ongoing interaction.',
          execute: async (input, executeOptions) => backend.execCommand(input, contextFor(turnId, executeOptions)),
          name: 'exec_command',
          parameters: execCommandSchema,
        }),
        tool({
          description: 'View a PNG, JPEG, GIF, or WebP image from the local filesystem.',
          execute: async (input, executeOptions) => {
            const image = await backend.viewImage(input, contextFor(turnId, executeOptions))
            return [
              {
                image_url: { detail: 'high', url: image.image_url },
                type: 'image_url',
              },
              {
                text: JSON.stringify({ detail: image.detail }),
                type: 'text',
              },
            ]
          },
          name: 'view_image',
          parameters: viewImageSchema,
        }),
        tool({
          description: 'Write characters to an existing exec session, or poll it for recent output.',
          execute: async (input, executeOptions) => backend.writeStdin(input, contextFor(turnId, executeOptions)),
          name: 'write_stdin',
          parameters: writeStdinSchema,
        }),
      ]

      if (backend.requestPermissions != null) {
        tools.push(tool({
          description: 'Request additional filesystem or network permissions and receive the granted subset.',
          execute: async (input, executeOptions) => {
            const grant = await backend.requestPermissions!(input, contextFor(turnId, executeOptions))
            const accepted = intersectPermissionGrant(input.permissions, grant, cwd)
            if (accepted.scope === 'session')
              sessionPermissions = mergePermissionProfiles(sessionPermissions, accepted.permissions)
            else
              turnPermissions.set(turnId, mergePermissionProfiles(turnPermissions.get(turnId) ?? {}, accepted.permissions))
            return accepted
          },
          name: 'request_permissions',
          parameters: requestPermissionsSchema,
        }))
      }

      return tools
    },
    name,
    onTurnFinish: ({ turnId }) => {
      turnPermissions.delete(turnId)
    },
    stop: async () => backend.stop?.(),
    version,
  }
}
