import type { PermissionDelta, SandboxProfile } from './types'

import process from 'node:process'

import { resolve } from 'node:path'

const unique = (values: readonly string[]) => [...new Set(values)]

const cloneProfile = (profile: Readonly<SandboxProfile>): SandboxProfile => ({
  fileSystem: {
    allowRead: [...profile.fileSystem.allowRead],
    allowWrite: [...profile.fileSystem.allowWrite],
    denyRead: [...profile.fileSystem.denyRead],
    denyWrite: [...profile.fileSystem.denyWrite],
  },
  name: profile.name,
  network: {
    allowedDomains: [...profile.network.allowedDomains],
    allowLocalBinding: profile.network.allowLocalBinding,
    allowUnixSockets: [...profile.network.allowUnixSockets],
    deniedDomains: [...profile.network.deniedDomains],
  },
  route: profile.route,
})

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
  const cwd = resolve(options.cwd ?? process.cwd())

  return {
    ...readOnlyProfile({ denyRead: options.denyRead, name: options.name ?? 'workspace-write' }),
    fileSystem: {
      allowRead: [],
      allowWrite: unique([cwd, ...(options.writableRoots ?? []).map(path => resolve(cwd, path))]),
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
  const next = cloneProfile(profile)
  const base = resolve(cwd)

  next.name = `${profile.name}+temporary`
  next.fileSystem.allowRead = unique([
    ...next.fileSystem.allowRead,
    ...(delta.fileSystem?.allowRead ?? []).map(path => resolve(base, path)),
  ])
  next.fileSystem.allowWrite = unique([
    ...next.fileSystem.allowWrite,
    ...(delta.fileSystem?.allowWrite ?? []).map(path => resolve(base, path)),
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
