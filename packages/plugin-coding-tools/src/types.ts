import type { ToolExecuteOptions, ToolExecuteResult } from '@xsai/shared-chat'
import type { z } from 'zod'

import type {
  applyPatchSchema,
  execCommandSchema,
  permissionProfileSchema,
  requestPermissionsSchema,
  viewImageSchema,
  writeStdinSchema,
} from './schemas'

export type ApplyPatchInput = z.output<typeof applyPatchSchema>

export type ApprovalAwareToolExecuteOptions = ToolExecuteOptions & {
  approvalResolution?: unknown
}

export interface CodingToolsBackend {
  applyPatch: (input: ApplyPatchInput, context: CodingToolsBackendContext) => Promise<ToolExecuteResult> | ToolExecuteResult
  execCommand: (input: ExecCommandInput, context: CodingToolsBackendContext) => ExecCommandOutput | Promise<ExecCommandOutput>
  requestPermissions?: (input: RequestPermissionsInput, context: CodingToolsBackendContext) => PermissionGrant | Promise<PermissionGrant>
  stop?: () => Promise<void> | void
  viewImage: (input: ViewImageInput, context: CodingToolsBackendContext) => Promise<ViewImageOutput> | ViewImageOutput
  writeStdin: (input: WriteStdinInput, context: CodingToolsBackendContext) => Promise<WriteStdinOutput> | WriteStdinOutput
}

export interface CodingToolsBackendContext {
  approvalResolution?: unknown
  cwd: string
  permissions: PermissionProfile
  signal?: AbortSignal
  toolCallId: string
  turnId: string
}

export type ExecCommandInput = z.output<typeof execCommandSchema>

export interface ExecCommandOutput {
  chunk_id?: string
  exit_code?: number
  original_token_count?: number
  output: string
  session_id?: number
  wall_time_seconds: number
}

export type FileSystemPermissions = NonNullable<PermissionProfile['file_system']>

export type NetworkPermissions = NonNullable<PermissionProfile['network']>

export interface PermissionGrant {
  permissions: PermissionProfile
  scope: 'session' | 'turn'
}

export type PermissionProfile = z.output<typeof permissionProfileSchema>

export type RequestPermissionsInput = z.output<typeof requestPermissionsSchema>

export type ViewImageInput = z.output<typeof viewImageSchema>

export interface ViewImageOutput {
  detail: 'high'
  image_url: string
}

export type WriteStdinInput = z.output<typeof writeStdinSchema>

export type WriteStdinOutput = ExecCommandOutput
