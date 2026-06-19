import type {
  AgentCustomEntry,
  AgentEntry,
  AgentEvent,
  AgentPlugin,
  AgentStorage,
} from '@apeira/core'

import type {
  CloneOptions,
  CreateSessionOptions,
  Head,
  Session,
  SessionCheckoutEvent,
  SessionForkEvent,
  SessionRebaseEvent,
  SessionSnapshot,
} from './types'

import { entry } from '@apeira/core'

import { createMutationQueue } from './queue'
import { validateRef } from './ref'
import {
  branchPath,
  buildState,
  replay,
  resolveTarget,
  semanticPath,
} from './replay'
import { SessionError } from './types'

const normalizeError = (error: unknown): never => {
  if (error instanceof SessionError)
    throw error
  throw new SessionError('storage', 'Session storage operation failed.', { cause: error })
}

type BranchChangeHandler = (payload: SessionCheckoutEvent | SessionForkEvent | SessionRebaseEvent) => Promise<void>

const resolveCloneRefs = (
  snapshot: SessionSnapshot,
  options: CloneOptions,
): string[] => {
  if (options.refs === 'all')
    return [...snapshot.refs.keys()]
  if (options.refs != null && options.refs !== 'active') {
    for (const name of options.refs) {
      if (!snapshot.refs.has(name))
        throw new SessionError('not_found', `Session ref not found: ${name}`)
    }
    return [...options.refs]
  }
  if (snapshot.head.type === 'ref')
    return [snapshot.head.name]
  return []
}

export const createSession = (options: CreateSessionOptions): Session => {
  const queue = createMutationQueue()
  let initialized = false
  const branchChangeHandlers = new Set<BranchChangeHandler>()

  const notifyBranchChange = async (payload: Parameters<BranchChangeHandler>[0]) => {
    for (const handler of branchChangeHandlers) {
      try {
        await handler(payload)
      }
      catch (error) {
        console.warn('[@apeira/session] Branch change handler failed:', error)
      }
    }
  }

  const makeEntry = <T extends keyof AgentCustomEntry>(
    type: T,
    data: AgentCustomEntry[T],
    parentId?: string,
  ): AgentEntry<T> => ({
    ...entry(type, data),
    parentId,
  })

  const initialize = async () => {
    if (initialized)
      return

    if (options.defaultRef == null) {
      initialized = true
      return
    }

    validateRef(options.defaultRef)
    const entries = await options.sessionStorage.read()
    if (entries.length > 0) {
      initialized = true
      return
    }

    await options.sessionStorage.append(
      makeEntry('session/ref', { name: options.defaultRef }),
      makeEntry('session/checkout', {
        target: { name: options.defaultRef, type: 'ref' },
      }),
    )

    initialized = true
  }

  const read = async (): Promise<SessionSnapshot> => {
    try {
      await queue(initialize)
      return replay(await options.sessionStorage.read())
    }
    catch (error) {
      return normalizeError(error)
    }
  }

  const mutate = async <T>(operation: () => Promise<T>) => queue(async () => {
    try {
      await initialize()
      return await operation()
    }
    catch (error) {
      return normalizeError(error)
    }
  })

  const assertIdle = (entries: readonly AgentEntry[]) => {
    const active = new Set<string>()
    for (const entry of entries) {
      if (entry.type !== 'event')
        continue
      const data = entry.data as unknown
      if (typeof data !== 'object' || data === null || !('turnId' in data))
        continue
      const event = data as AgentEvent
      if (event.type === 'turn.start')
        active.add(event.turnId)
      else if (event.type === 'turn.done' || event.type === 'turn.failed' || event.type === 'turn.aborted')
        active.delete(event.turnId)
    }

    if (active.size > 0)
      throw new SessionError('busy', 'Session has an active agent turn.')
  }

  const appendControl = async (...entries: AgentEntry[]) =>
    options.sessionStorage.append(...entries)

  const path: Session['path'] = async (target) => {
    const snapshot = await read()
    return branchPath(snapshot, resolveTarget(snapshot, target, target == null))
  }

  const storage: AgentStorage<AgentEntry> = {
    append: async (...entries) => mutate(async () => {
      if (entries.length === 0)
        return

      const snapshot = replay(await options.sessionStorage.read())
      let tail = snapshot.headTargetId
      const appended = entries.map((entry) => {
        const next = {
          ...entry,
          parentId: entry.parentId ?? tail,
        }

        if (next.type !== 'event' && next.type !== 'session/checkout' && next.type !== 'session/ref')
          tail = next.id

        return next
      })

      const controls: AgentEntry[] = []
      if (tail !== snapshot.headTargetId) {
        if (snapshot.head.type === 'ref') {
          controls.push(makeEntry('session/ref', {
            name: snapshot.head.name,
            targetId: tail,
          }))
        }
        else {
          controls.push(makeEntry('session/checkout', {
            target: tail == null ? { type: 'empty' } : { id: tail, type: 'id' },
          }))
        }
      }

      await appendControl(...appended, ...controls)
    }),
    clear: async () => mutate(async () => {
      await appendControl(makeEntry('session/checkout', { target: { type: 'empty' } }))
    }),
    read: async () => path(),
  }

  const checkout: Session['checkout'] = async target => mutate(async () => {
    const snapshot = replay(await options.sessionStorage.read())
    assertIdle(snapshot.entries)

    if (target == null) {
      await appendControl(makeEntry('session/checkout', { target: { type: 'empty' } }))
    }
    else if (snapshot.refs.has(target)) {
      await appendControl(makeEntry('session/checkout', {
        target: { name: target, type: 'ref' },
      }))
    }
    else if (snapshot.entryById.has(target)) {
      await appendControl(makeEntry('session/checkout', {
        target: { id: target, type: 'id' },
      }))
    }
    else {
      throw new SessionError('not_found', `Session target not found: ${target}`)
    }

    const newSnapshot = replay(await options.sessionStorage.read())
    const payload: SessionCheckoutEvent = {
      ref: newSnapshot.head.type === 'ref' ? newSnapshot.head.name : undefined,
      state: buildState(branchPath(newSnapshot, newSnapshot.headTargetId)),
      targetId: newSnapshot.headTargetId,
      type: 'checkout',
    }
    await notifyBranchChange(payload)
  })

  const fork: Session['fork'] = async (name, forkOptions) => mutate(async () => {
    validateRef(name)
    const snapshot = replay(await options.sessionStorage.read())
    assertIdle(snapshot.entries)
    const targetId = resolveTarget(snapshot, forkOptions?.from, forkOptions?.from == null)
    const entries: AgentEntry[] = [makeEntry('session/ref', { name, targetId })]

    if (forkOptions?.checkout !== false) {
      entries.push(makeEntry('session/checkout', {
        target: { name, type: 'ref' },
      }))
    }

    await appendControl(...entries)

    if (forkOptions?.checkout !== false) {
      const newSnapshot = replay(await options.sessionStorage.read())
      const payload: SessionForkEvent = {
        ref: name,
        state: buildState(branchPath(newSnapshot, newSnapshot.headTargetId)),
        targetId: newSnapshot.headTargetId,
        type: 'fork',
      }
      await notifyBranchChange(payload)
    }
  })

  const rebase: Session['rebase'] = async (name, onto) => mutate(async () => {
    const snapshot = replay(await options.sessionStorage.read())
    assertIdle(snapshot.entries)
    if (!snapshot.refs.has(name))
      throw new SessionError('not_found', `Session ref not found: ${name}`)

    const oldHeadId = snapshot.refs.get(name)
    const newBaseId = resolveTarget(snapshot, onto)
    const source = semanticPath(snapshot, oldHeadId)
    const targetIds = new Set(semanticPath(snapshot, newBaseId).map(entry => entry.id))
    const ancestor = source.findLast(entry => targetIds.has(entry.id))
    const copied = source.slice(ancestor == null ? 0 : source.indexOf(ancestor) + 1)

    let parentId = newBaseId
    const mapping: Array<{ newId: string, oldId: string }> = []
    const entries = copied.map((entry) => {
      const next: AgentEntry = makeEntry(entry.type, entry.data, parentId)
      mapping.push({ newId: next.id, oldId: entry.id })
      parentId = next.id
      return next
    })

    await appendControl(
      ...entries,
      makeEntry('session/ref', { name, targetId: parentId }),
    )

    const newSnapshot = replay(await options.sessionStorage.read())
    if (newSnapshot.head.type === 'ref' && newSnapshot.head.name === name) {
      const payload: SessionRebaseEvent = {
        ref: name,
        state: buildState(branchPath(newSnapshot, newSnapshot.headTargetId)),
        targetId: newSnapshot.headTargetId,
        type: 'rebase',
      }
      await notifyBranchChange(payload)
    }

    return {
      entries: mapping,
      name,
      newBaseId,
      newHeadId: parentId,
      oldBaseId: ancestor?.id,
      oldHeadId,
    }
  })

  const clone: Session['clone'] = async cloneOptions => mutate(async () => {
    const snapshot = replay(await options.sessionStorage.read())
    assertIdle(snapshot.entries)
    const selectedRefs = resolveCloneRefs(snapshot, cloneOptions)
    const targetIds = [
      resolveTarget(snapshot, cloneOptions.from, cloneOptions.from == null),
      ...selectedRefs.map(name => snapshot.refs.get(name)),
    ]
    const semanticIds = new Set(targetIds.flatMap(target =>
      semanticPath(snapshot, target).map(entry => entry.id),
    ))
    const copied = snapshot.entries.filter(entry =>
      semanticIds.has(entry.id)
      || (entry.type === 'event'
        && entry.parentId != null
        && semanticIds.has(entry.parentId)),
    )
    const controls = selectedRefs.map(name =>
      makeEntry('session/ref', { name, targetId: snapshot.refs.get(name) }),
    )

    await cloneOptions.sessionStorage.append(...copied, ...controls)
    const cloned = createSession({
      ...options,
      defaultRef: undefined,
      sessionStorage: cloneOptions.sessionStorage,
    })

    const checkoutTarget = cloneOptions.checkout
      ?? (snapshot.head.type === 'ref' && selectedRefs.includes(snapshot.head.name)
        ? snapshot.head.name
        : (cloneOptions.from ?? snapshot.headTargetId))
    await cloned.checkout(checkoutTarget)
    return cloned
  })

  const buildInput: Session['buildInput'] = async (target) => {
    return (await path(target))
      .filter((entry): entry is AgentEntry<'input'> => entry.type === 'input')
      .map(entry => entry.data)
  }

  const createPlugin = (): AgentPlugin => {
    let handler: BranchChangeHandler | undefined

    return {
      init: (agent) => {
        handler = async (payload) => {
          agent.state.restore(payload.state)
          await agent.emit(`session.${payload.type}`, payload, { save: false })
        }
        branchChangeHandlers.add(handler)
      },
      name: 'apeira.session',
      stop: () => {
        if (!handler)
          return
        branchChangeHandlers.delete(handler)
        handler = undefined
      },
    }
  }

  return {
    buildInput,
    buildState: async target => buildState(await path(target)),
    checkout,
    clone,
    event: async (event, eventOptions) => mutate(async () => {
      const snapshot = replay(await options.sessionStorage.read())
      const result = makeEntry(
        'event',
        event as AgentCustomEntry['event'],
        eventOptions?.parentId ?? snapshot.headTargetId,
      )
      await appendControl(result)
      return result
    }),
    fork,
    head: async (): Promise<Head> => (await read()).head,
    path,
    get plugin() {
      return createPlugin()
    },
    read,
    rebase,
    refs: async () => (await read()).refs,
    sessionStorage: options.sessionStorage,
    storage,
  }
}
