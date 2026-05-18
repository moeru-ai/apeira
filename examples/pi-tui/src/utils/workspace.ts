import path from 'node:path'

import { workspaceRoot } from './config'

export const relativeToWorkspace = (targetPath: string) =>
  path.relative(workspaceRoot, targetPath) || '.'

export const resolveWorkspacePath = (inputPath: string) => {
  const resolved = path.resolve(workspaceRoot, inputPath)
  const relative = path.relative(workspaceRoot, resolved)

  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`Path escapes workspace: ${inputPath}`)

  return resolved
}
