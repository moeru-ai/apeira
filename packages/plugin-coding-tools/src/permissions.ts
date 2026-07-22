import type { PermissionGrant, PermissionProfile } from './types'

import { resolve } from 'node:path'

import { isWithin } from './utils/is-within'

const unique = (items: string[]) => [...new Set(items)]

const normalizePaths = (paths: string[] | undefined, cwd: string) =>
  unique((paths ?? []).map(path => resolve(cwd, path)))

export const normalizePermissionProfile = (
  profile: PermissionProfile,
  cwd: string,
): PermissionProfile => {
  const read = normalizePaths(profile.file_system?.read, cwd)
  const write = normalizePaths(profile.file_system?.write, cwd)

  return {
    ...(read.length > 0 || write.length > 0
      ? {
          file_system: {
            ...(read.length > 0 ? { read } : {}),
            ...(write.length > 0 ? { write } : {}),
          },
        }
      : {}),
    ...(profile.network?.enabled === true ? { network: { enabled: true } } : {}),
  }
}

const intersectPaths = (requested: string[] | undefined, granted: string[] | undefined) => {
  const roots = requested ?? []
  return unique((granted ?? []).filter(path => roots.some(root => isWithin(path, root))))
}

export const intersectPermissionGrant = (
  request: PermissionProfile,
  grant: PermissionGrant,
  cwd: string,
): PermissionGrant => {
  const requested = normalizePermissionProfile(request, cwd)
  const granted = normalizePermissionProfile(grant.permissions, cwd)
  const read = intersectPaths(requested.file_system?.read, granted.file_system?.read)
  const write = intersectPaths(requested.file_system?.write, granted.file_system?.write)

  return {
    permissions: {
      ...(read.length > 0 || write.length > 0
        ? {
            file_system: {
              ...(read.length > 0 ? { read } : {}),
              ...(write.length > 0 ? { write } : {}),
            },
          }
        : {}),
      ...(requested.network?.enabled === true && granted.network?.enabled === true
        ? { network: { enabled: true } }
        : {}),
    },
    scope: grant.scope === 'session' ? 'session' : 'turn',
  }
}

export const mergePermissionProfiles = (...profiles: PermissionProfile[]): PermissionProfile => {
  const read = unique(profiles.flatMap(profile => profile.file_system?.read ?? []))
  const write = unique(profiles.flatMap(profile => profile.file_system?.write ?? []))

  return {
    ...(read.length > 0 || write.length > 0
      ? {
          file_system: {
            ...(read.length > 0 ? { read } : {}),
            ...(write.length > 0 ? { write } : {}),
          },
        }
      : {}),
    ...(profiles.some(profile => profile.network?.enabled === true)
      ? { network: { enabled: true } }
      : {}),
  }
}

export const permissionGrantFromResolution = (
  resolution: unknown,
  fallback: PermissionProfile,
): PermissionGrant => {
  if (resolution == null || typeof resolution !== 'object' || Array.isArray(resolution))
    return { permissions: fallback, scope: 'turn' }

  const candidate = resolution as Partial<PermissionGrant>
  if (candidate.permissions == null || typeof candidate.permissions !== 'object')
    return { permissions: fallback, scope: 'turn' }

  return {
    permissions: candidate.permissions,
    scope: candidate.scope === 'session' ? 'session' : 'turn',
  }
}
