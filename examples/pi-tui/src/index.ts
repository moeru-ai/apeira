import { join } from 'node:path'
import { cwd, env, loadEnvFile } from 'node:process'

import { findWorkspaceDir } from '@pnpm/find-workspace-dir'

// eslint-disable-next-line antfu/no-top-level-await
const workspaceDir = await findWorkspaceDir(cwd())
const envRoot = workspaceDir ?? cwd()

// eslint-disable-next-line @masknet/no-top-level
env.APEIRA_CWD ??= envRoot

try {
  loadEnvFile(join(envRoot, '.env'))
}
catch {}

try {
  loadEnvFile(join(envRoot, '.env.local'))
}
catch {}

// eslint-disable-next-line antfu/no-top-level-await
const { createPiTuiExampleApp } = await import('./app')

// eslint-disable-next-line @masknet/no-top-level
createPiTuiExampleApp().start()
