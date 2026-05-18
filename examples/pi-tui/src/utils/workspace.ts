import fs from 'node:fs/promises'
import path from 'node:path'

import { workspaceRoot } from './config'

export const relativeToWorkspace = (targetPath: string) =>
  path.relative(workspaceRoot, targetPath) || '.'

const isInsideWorkspace = (workspacePath: string, targetPath: string) => {
  const relative = path.relative(workspacePath, targetPath)

  return !(relative.startsWith('..') || path.isAbsolute(relative))
}

const findExistingParent = async (targetPath: string): Promise<string> => {
  try {
    await fs.lstat(targetPath)
    return targetPath
  }
  catch {
    const parentPath = path.dirname(targetPath)

    if (parentPath === targetPath)
      throw new Error(`Path does not have an existing parent: ${targetPath}`)

    return findExistingParent(parentPath)
  }
}

export const resolveWorkspacePath = async (inputPath: string, allowMissing = false) => {
  const realWorkspaceRoot = await fs.realpath(workspaceRoot)
  const resolvedPath = path.resolve(workspaceRoot, inputPath)

  try {
    const realTargetPath = await fs.realpath(resolvedPath)

    if (!isInsideWorkspace(realWorkspaceRoot, realTargetPath))
      throw new Error(`Path escapes workspace: ${inputPath}`)

    return realTargetPath
  }
  catch (error) {
    if (!allowMissing || !(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
      throw error

    const existingParentPath = await findExistingParent(path.dirname(resolvedPath))
    const realParentPath = await fs.realpath(existingParentPath)
    const missingSuffix = path.relative(existingParentPath, resolvedPath)
    const candidatePath = path.resolve(realParentPath, missingSuffix)

    if (!isInsideWorkspace(realWorkspaceRoot, realParentPath) || !isInsideWorkspace(realWorkspaceRoot, candidatePath))
      throw new Error(`Path escapes workspace: ${inputPath}`)

    return candidatePath
  }
}
