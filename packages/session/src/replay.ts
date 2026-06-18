import type { AgentEntry, AgentState } from '@apeira/core'

import type { Head, SessionSnapshot } from './types'

import { SessionError } from './types'

const detached: Head = { type: 'detached' }

export const replay = (entries: readonly AgentEntry[]): SessionSnapshot => {
  const entryById = new Map(entries.map(entry => [entry.id, entry]))
  const refs = new Map<string, string | undefined>()
  let head: Head = detached

  for (const entry of entries) {
    if (entry.type === 'session/ref') {
      const data = entry.data as { name: string, targetId?: string }
      refs.set(data.name, data.targetId)
    }
    else if (entry.type === 'session/checkout') {
      const target = (entry.data as {
        target:
          | { id: string, type: 'id' }
          | { name: string, type: 'ref' }
          | { type: 'empty' }
      }).target

      head = target.type === 'ref'
        ? { name: target.name, type: 'ref' }
        : { targetId: target.type === 'id' ? target.id : undefined, type: 'detached' }
    }
  }

  return {
    entries,
    entryById,
    head,
    headTargetId: head.type === 'ref' ? refs.get(head.name) : head.targetId,
    refs,
  }
}

export const resolveTarget = (
  snapshot: SessionSnapshot,
  target: string | undefined,
  useHead = false,
): string | undefined => {
  if (target == null)
    return useHead ? snapshot.headTargetId : undefined

  if (snapshot.refs.has(target))
    return snapshot.refs.get(target)

  if (snapshot.entryById.has(target))
    return target

  throw new SessionError('not_found', `Session target not found: ${target}`)
}

export const semanticPath = (
  snapshot: SessionSnapshot,
  targetId: string | undefined,
): AgentEntry[] => {
  const result: AgentEntry[] = []
  let currentId = targetId

  while (currentId != null) {
    const current = snapshot.entryById.get(currentId)
    if (current == null)
      throw new SessionError('not_found', `Session entry not found: ${currentId}`)

    result.push(current)
    currentId = current.parentId
  }

  return result.reverse()
}

export const branchPath = (
  snapshot: SessionSnapshot,
  targetId: string | undefined,
): AgentEntry[] => {
  const semantic = semanticPath(snapshot, targetId)
  const semanticIds = new Set(semantic.map(entry => entry.id))

  return snapshot.entries.filter(entry =>
    semanticIds.has(entry.id)
    || (entry.type === 'event'
      && entry.parentId != null
      && semanticIds.has(entry.parentId)),
  )
}

export const buildState = (
  entries: readonly AgentEntry[],
): Readonly<AgentState> =>
  (entries.findLast(entry => entry.type === 'state')?.data ?? {}) as AgentState
