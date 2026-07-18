import type { PermissionDelta, SandboxProfile } from './types'

import process from 'node:process'

import { realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const unique = (values: readonly string[]) => [...new Set(values)]

/** Resolve symlinked ancestors while retaining a path that does not exist yet. */
export const canonicalizePath = (path: string, cwd = process.cwd()) => {
  let current = resolve(cwd, path)
  const missing: string[] = []

  while (true) {
    try {
      const canonical = realpathSync.native(current)
      const suffix = [...missing]
      suffix.reverse()
      return join(canonical, ...suffix)
    }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR')
        throw error
      const parent = dirname(current)
      if (parent === current)
        return current
      missing.push(basename(current))
      current = parent
    }
  }
}

export const readOnlyProfile = (options: {
  allowRead?: string[]
  denyRead?: string[]
  name?: string
} = {}): SandboxProfile => ({
  fileSystem: {
    allowRead: options.allowRead ?? [],
    allowWrite: [],
    denyRead: options.denyRead ?? [],
    denyWrite: [],
  },
  name: options.name ?? 'read-only',
  network: {
    allowedDomains: [],
    allowLocalBinding: false,
    allowUnixSockets: [],
    deniedDomains: [],
  },
  route: 'sandbox',
})

export const workspaceWriteProfile = (options: {
  cwd?: string
  denyRead?: string[]
  denyWrite?: string[]
  name?: string
  writableRoots?: string[]
} = {}): SandboxProfile => {
  const cwd = canonicalizePath(options.cwd ?? process.cwd())

  return {
    ...readOnlyProfile({ denyRead: options.denyRead, name: options.name ?? 'workspace-write' }),
    fileSystem: {
      allowRead: [],
      allowWrite: unique([cwd, ...(options.writableRoots ?? []).map(path => canonicalizePath(path, cwd))]),
      denyRead: options.denyRead ?? [],
      denyWrite: options.denyWrite ?? [],
    },
  }
}

export const fullAccessProfile = (name = 'full-access'): SandboxProfile => ({
  ...readOnlyProfile({ name }),
  name,
  route: 'host',
})

export const applyPermissionDelta = (
  profile: Readonly<SandboxProfile>,
  delta: Readonly<PermissionDelta>,
  cwd = process.cwd(),
): SandboxProfile => {
  const next = structuredClone(profile as SandboxProfile)
  const base = canonicalizePath(cwd)

  next.name = `${profile.name}+temporary`
  next.fileSystem.allowRead = unique([
    ...next.fileSystem.allowRead,
    ...(delta.fileSystem?.allowRead ?? []).map(path => canonicalizePath(path, base)),
  ])
  next.fileSystem.allowWrite = unique([
    ...next.fileSystem.allowWrite,
    ...(delta.fileSystem?.allowWrite ?? []).map(path => canonicalizePath(path, base)),
  ])
  next.network.allowedDomains = unique([
    ...next.network.allowedDomains,
    ...(delta.network?.allowedDomains ?? []),
  ])
  next.network.allowUnixSockets = unique([
    ...next.network.allowUnixSockets,
    ...(delta.network?.allowUnixSockets ?? []),
  ])
  next.network.allowLocalBinding ||= delta.network?.allowLocalBinding === true

  return next
}
