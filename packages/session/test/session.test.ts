import type { AgentEntry } from '@apeira/core'

import { assistant, createAgent, entry, mem, run, user } from '@apeira/core'
import { describe, expect, it } from 'vitest'

import { isCompaction } from '../../plugin-compact/src'
import { createSession, SessionError } from '../src'

const ids = () => {
  let value = 0
  return () => `id-${++value}`
}

const inputText = (entries: readonly AgentEntry[]) =>
  entries
    .filter((entry): entry is AgentEntry<'input'> => entry.type === 'input')
    .map(entry => entry.data)

describe('session replay and storage', () => {
  it('bootstraps a default ref and advances it with semantic entries', async () => {
    const sessionStorage = mem()
    const session = createSession({
      defaultRef: 'main',
      id: ids(),
      now: () => 1,
      sessionStorage,
    })

    await session.storage.append(
      entry('input', user('hello')),
      entry('state', { agentName: 'test' }),
      entry('input', assistant('hi')),
    )

    expect(await session.head()).toEqual({ name: 'main', type: 'ref' })
    expect(inputText(await session.storage.read())).toEqual([
      user('hello'),
      assistant('hi'),
    ])
    expect(await session.buildState()).toEqual({ agentName: 'test' })
    expect((await session.refs()).get('main')).toBeDefined()

    const raw = await sessionStorage.read()
    const semantic = raw.filter(entry =>
      entry.type === 'input' || entry.type === 'state',
    )
    expect(semantic[0]?.parentId).toBeUndefined()
    expect(semantic[1]?.parentId).toBe(semantic[0]?.id)
    expect(semantic[2]?.parentId).toBe(semantic[1]?.id)
  })

  it('forks and checks out independent branch paths', async () => {
    const session = createSession({
      defaultRef: 'main',
      id: ids(),
      sessionStorage: mem(),
    })

    await session.storage.append(entry('input', user('root')))
    await session.fork('feature')
    await session.storage.append(entry('input', user('feature')))
    await session.checkout('main')
    await session.storage.append(entry('input', user('main')))

    expect(await session.buildInput('feature')).toEqual([
      user('root'),
      user('feature'),
    ])
    expect(await session.buildInput('main')).toEqual([
      user('root'),
      user('main'),
    ])
  })

  it('supports detached and empty checkout, clear, and reset', async () => {
    const session = createSession({
      defaultRef: 'main',
      id: ids(),
      sessionStorage: mem(),
    })

    await session.storage.append(entry('input', user('root')))
    const rootId = (await session.read()).headTargetId!
    await session.checkout(rootId)
    await session.storage.append(entry('input', user('detached')))

    expect((await session.head()).type).toBe('detached')
    expect(await session.buildInput()).toEqual([
      user('root'),
      user('detached'),
    ])

    await session.storage.clear()
    expect(await session.buildInput()).toEqual([])

    await session.checkout('main')
    await session.storage.reset()
    expect(await session.buildInput()).toEqual([])
    expect(await session.head()).toEqual({ name: 'main', type: 'ref' })
  })

  it('rejects unknown targets and invalid refs', async () => {
    const session = createSession({ sessionStorage: mem() })

    await expect(session.checkout('missing')).rejects.toMatchObject({
      code: 'not_found',
    })
    await expect(session.fork('bad..lock')).rejects.toBeInstanceOf(SessionError)
  })
})

describe('session operations', () => {
  it('rebases source-only semantic entries and leaves the source chain intact', async () => {
    const session = createSession({
      defaultRef: 'main',
      id: ids(),
      sessionStorage: mem(),
    })

    await session.storage.append(entry('input', user('root')))
    await session.fork('feature')
    await session.storage.append(
      entry('input', user('feature one')),
      entry('state', { agentDescription: 'feature' }),
    )
    const oldFeature = await session.buildInput('feature')

    await session.checkout('main')
    await session.storage.append(entry('input', user('main one')))
    const result = await session.rebase('feature', 'main')

    expect(result.entries).toHaveLength(2)
    expect(result.oldBaseId).toBeDefined()
    expect(result.newBaseId).toBe((await session.refs()).get('main'))
    expect(await session.buildInput('feature')).toEqual([
      user('root'),
      user('main one'),
      user('feature one'),
    ])
    expect(oldFeature).toEqual([user('root'), user('feature one')])
    expect((await session.sessionStorage.read())
      .filter(entry => entry.type === 'input')
      .map(entry => entry.data))
      .toContainEqual(user('feature one'))
  })

  it('clones the active ref into separate storage', async () => {
    const source = createSession({
      defaultRef: 'main',
      id: ids(),
      isCompaction,
      sessionStorage: mem(),
    })
    await source.storage.append(
      entry('input', user('old')),
      entry('compact/boundary', { preTokens: 100, trigger: 'auto' }),
      entry('input', user('source')),
    )

    const destination = mem()
    const cloned = await source.clone({ sessionStorage: destination })

    expect(await cloned.head()).toEqual({ name: 'main', type: 'ref' })
    expect(await cloned.buildInput()).toEqual([user('source')])
    expect(inputText(await cloned.path())).toEqual([user('old'), user('source')])

    await cloned.storage.append(entry('input', user('clone')))
    expect(await source.buildInput()).toEqual([user('source')])
  })

  it('clones all selected refs', async () => {
    const source = createSession({
      defaultRef: 'main',
      id: ids(),
      sessionStorage: mem(),
    })
    await source.storage.append(entry('input', user('root')))
    await source.fork('feature')
    await source.storage.append(entry('input', user('feature')))
    await source.checkout('main')

    const cloned = await source.clone({
      refs: 'all',
      sessionStorage: mem(),
    })

    expect([...await cloned.refs().then(refs => refs.keys())]).toEqual([
      'main',
      'feature',
    ])
    expect(await cloned.buildInput('feature')).toEqual([
      user('root'),
      user('feature'),
    ])
  })

  it('uses the latest compaction boundary for model-facing storage', async () => {
    const session = createSession({
      defaultRef: 'main',
      id: ids(),
      isCompaction,
      sessionStorage: mem(),
    })

    await session.storage.append(
      entry('input', user('old')),
      entry('compact/boundary', { preTokens: 100, trigger: 'auto' }),
      entry('input', user('summary')),
      entry('state', { userDescription: 'compacted' }),
    )

    expect(await session.buildInput()).toEqual([user('summary')])
    expect(inputText(await session.path())).toEqual([
      user('old'),
      user('summary'),
    ])
    expect(inputText(await session.storage.read())).toEqual([user('summary')])
    expect(await session.buildState()).toEqual({ userDescription: 'compacted' })
  })

  it('blocks branch movement between turn.start and its terminal event', async () => {
    const session = createSession({
      defaultRef: 'main',
      id: ids(),
      sessionStorage: mem(),
    })

    await session.storage.append(entry('event', {
      turnId: 'turn-1',
      type: 'turn.start',
    }))
    await expect(session.fork('busy')).rejects.toMatchObject({ code: 'busy' })

    await session.storage.append(entry('event', {
      turnId: 'turn-1',
      type: 'turn.done',
    }))
    await expect(session.fork('ready')).resolves.toBeUndefined()
  })

  it('serializes concurrent mutations', async () => {
    const backing = mem()
    let active = 0
    let maxActive = 0
    const session = createSession({
      defaultRef: 'main',
      id: ids(),
      sessionStorage: {
        ...backing,
        append: async (...entries) => {
          active++
          maxActive = Math.max(maxActive, active)
          await new Promise((resolve) => {
            const timer = setTimeout(resolve, 5)
            void timer
          })
          await backing.append(...entries)
          active--
        },
      },
    })

    await Promise.all([
      session.storage.append(entry('input', user('one'))),
      session.storage.append(entry('input', user('two'))),
    ])

    expect(maxActive).toBe(1)
    expect(await session.buildInput()).toEqual([user('one'), user('two')])
  })

  it('integrates with core and persists lifecycle events in the raw log', async () => {
    const session = createSession({
      defaultRef: 'main',
      id: ids(),
      sessionStorage: mem(),
    })
    const agent = createAgent({
      instructions: '',
      runner: async context => ({
        output: [assistant(`reply to ${context.input.length}`)],
      }),
      storage: session.storage,
    })

    for await (const event of run(agent, user('hello')))
      void event

    expect(await session.buildInput()).toEqual([
      user('hello'),
      assistant('reply to 1'),
    ])

    const eventTypes = (await session.sessionStorage.read())
      .filter((entry): entry is AgentEntry<'event'> => entry.type === 'event')
      .map(entry => entry.data.type)
    expect(eventTypes).toContain('turn.start')
    expect(eventTypes).toContain('turn.done')
  })
})
