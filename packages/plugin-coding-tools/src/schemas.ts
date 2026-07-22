import { z } from 'zod'

export const applyPatchSchema = z.object({
  patch: z.string().describe('A standard Git patch to apply.'),
  workdir: z.string().optional().describe('Working directory relative to the plugin cwd.'),
}).strict()

export const execCommandSchema = z.object({
  cmd: z.string().describe('Shell command to execute.'),
  login: z.boolean().optional().describe('Use login shell semantics. Defaults to true.'),
  max_output_tokens: z.number().optional().describe('Output token budget. Defaults to 10000.'),
  shell: z.string().optional().describe('Shell binary. Defaults to the platform user shell.'),
  tty: z.boolean().optional().describe('Allocate a PTY. Built-in backends do not support true.'),
  workdir: z.string().optional().describe('Working directory relative to the plugin cwd.'),
  yield_time_ms: z.number().optional().describe('Wait before yielding. Defaults to 10000 ms.'),
}).strict()

export const writeStdinSchema = z.object({
  chars: z.string().optional().describe('Characters to write. Empty or omitted polls output.'),
  max_output_tokens: z.number().optional().describe('Output token budget. Defaults to 10000.'),
  session_id: z.number().describe('Running exec_command session identifier.'),
  yield_time_ms: z.number().optional().describe('Wait before returning recent output.'),
}).strict()

export const viewImageSchema = z.object({
  detail: z.enum(['high', 'original']).optional().describe('Requested detail. original currently degrades to high.'),
  path: z.string().describe('Local image path relative to the plugin cwd.'),
}).strict()

export const permissionProfileSchema = z.object({
  file_system: z.object({
    read: z.array(z.string()).optional(),
    write: z.array(z.string()).optional(),
  }).strict().optional(),
  network: z.object({
    enabled: z.boolean().optional(),
  }).strict().optional(),
}).strict()

export const requestPermissionsSchema = z.object({
  permissions: permissionProfileSchema,
  reason: z.string().optional().describe('Short explanation for the permission request.'),
}).strict()
