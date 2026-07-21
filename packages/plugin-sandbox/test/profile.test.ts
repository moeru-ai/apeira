import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  applyPermissionDelta,
  fullAccessProfile,
  readOnlyProfile,
  workspaceWriteProfile,
} from '../src'

describe('sandbox profiles', () => {
  it('creates conservative read-only defaults', () => {
    expect(readOnlyProfile()).toEqual({
      fileSystem: { allowRead: [], allowWrite: [], denyRead: [], denyWrite: [] },
      name: 'read-only',
      network: {
        allowedDomains: [],
        allowLocalBinding: false,
        allowUnixSockets: [],
        deniedDomains: [],
      },
      route: 'sandbox',
    })
  })

  it('normalizes workspace roots and removes duplicates', () => {
    const profile = workspaceWriteProfile({
      cwd: '/workspace/project',
      writableRoots: ['output', '/workspace/project'],
    })

    expect(profile.fileSystem.allowWrite).toEqual([
      resolve('/workspace/project'),
      resolve('/workspace/project/output'),
    ])
  })

  it('resolves temporary filesystem permissions against the request cwd', () => {
    const original = readOnlyProfile()
    const expanded = applyPermissionDelta(original, {
      fileSystem: { allowRead: ['fixtures'], allowWrite: ['output'] },
      network: { allowedDomains: ['example.com'], allowLocalBinding: true },
    }, '/workspace/project')

    expect(expanded.fileSystem.allowRead).toEqual(['/workspace/project/fixtures'])
    expect(expanded.fileSystem.allowWrite).toEqual(['/workspace/project/output'])
    expect(expanded.network.allowedDomains).toEqual(['example.com'])
    expect(expanded.network.allowLocalBinding).toBe(true)
    expect(original.fileSystem.allowRead).toEqual([])
  })

  it('routes full access through an explicit host executor', () => {
    expect(fullAccessProfile().route).toBe('host')
  })
})
