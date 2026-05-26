/* eslint-disable antfu/no-top-level-await */
/* eslint-disable @masknet/no-top-level */
import { join } from 'node:path'
import { cwd, env, loadEnvFile } from 'node:process'

import { findWorkspaceDir } from '@pnpm/find-workspace-dir'

const workspaceDir = await findWorkspaceDir(cwd())
const envRoot = workspaceDir ?? cwd()

try {
  loadEnvFile(join(envRoot, '.env'))
}
catch {}

try {
  loadEnvFile(join(envRoot, '.env.local'))
}
catch {}

env.APEIRA_CWD ??= envRoot

const { startBot } = await import('./bot')

startBot()
