import type { AgentEntry, AgentState, AgentStateManager } from '@apeira/core'

import { assistant, createAgent, developer, entry, mem, run, user } from '@apeira/core'
import { describe, expect, it } from 'vitest'

import { compact } from '../../plugin-compact/src'
import { createSession, SessionError } from '../src'

declare module '@apeira/core' {
  interface AgentCustomEntry {
    'test/checkpoint': {
      label: string
    }
  }
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
      sessionStorage: mem(),
    })

    await session.storage.append(entry('input', user('root')))
    await session.fork('feature')
    await session.storage.append(
      entry('input', user('feature one')),
      entry('test/checkpoint', { label: 'feature checkpoint' }),
      entry('state', { agentDescription: 'feature' }),
    )
    const oldFeature = await session.buildInput('feature')

    await session.checkout('main')
    await session.storage.append(entry('input', user('main one')))
    const result = await session.rebase('feature', 'main')

    expect(result.entries).toHaveLength(3)
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
    expect(await session.path('feature')).toContainEqual(expect.objectContaining({
      data: { label: 'feature checkpoint' },
      type: 'test/checkpoint',
    }))
  })

  it('clones the active ref into separate storage', async () => {
    const source = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })
    await source.storage.append(
      entry('input', user('old')),
      entry('test/checkpoint', { label: 'checkpoint' }),
      entry('input', user('source')),
    )

    const destination = mem()
    const cloned = await source.clone({ sessionStorage: destination })

    expect(await cloned.head()).toEqual({ name: 'main', type: 'ref' })
    expect(await cloned.buildInput()).toEqual([user('old'), user('source')])
    expect(inputText(await cloned.path())).toEqual([user('old'), user('source')])
    expect(await cloned.path()).toContainEqual(expect.objectContaining({
      data: { label: 'checkpoint' },
      type: 'test/checkpoint',
    }))

    await cloned.storage.append(entry('input', user('clone')))
    expect(await source.buildInput()).toEqual([user('old'), user('source')])
  })

  it('clones all selected refs', async () => {
    const source = createSession({
      defaultRef: 'main',
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

  it('treats arbitrary custom entries as semantic branch nodes', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(
      entry('input', user('old')),
      entry('test/checkpoint', { label: 'checkpoint' }),
      entry('state', { userDescription: 'current' }),
    )

    const path = await session.path()
    const checkpoint = path.find(entry => entry.type === 'test/checkpoint')
    const state = path.find(entry => entry.type === 'state')

    expect(path.map(entry => entry.type)).toEqual([
      'input',
      'test/checkpoint',
      'state',
    ])
    expect(checkpoint?.parentId).toBe(path.find(entry => entry.type === 'input')?.id)
    expect(state?.parentId).toBe(checkpoint?.id)
    expect((await session.refs()).get('main')).toBe(state?.id)
    expect(await session.buildInput()).toEqual([user('old')])
    expect(await session.buildState()).toEqual({ userDescription: 'current' })
  })

  it('blocks branch movement between turn.start and its terminal event', async () => {
    const session = createSession({
      defaultRef: 'main',
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
      .map(entry => (entry.data as { type: string }).type)
    expect(eventTypes).toContain('turn.start')
    expect(eventTypes).toContain('turn.done')
  })

  it('uses compact identically with plain and session storage', async () => {
    const runWithStorage = async (storage: ReturnType<typeof mem>) => {
      const inputs: unknown[][] = []
      const agent = createAgent({
        initialState: { contextLength: 1000 },
        instructions: '',
        plugins: [
          compact({
            compactAgent: {
              runner: async () => ({
                output: [assistant('summary')],
                usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              }),
            },
            threshold: 0,
          }),
        ],
        runner: async (context) => {
          inputs.push([...context.input])
          return {
            output: [assistant('answer')],
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          }
        },
        storage,
      })

      for await (const event of run(agent, user('first')))
        void event
      await agent.wait()
      for await (const event of run(agent, user('second')))
        void event
      await agent.wait()

      return inputs[1]
    }

    const plainInput = await runWithStorage(mem())
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })
    const sessionInput = await runWithStorage(session.storage)

    expect(plainInput).toEqual([
      developer('<context_summary>\nsummary\n</context_summary>'),
      user('second'),
    ])
    expect(sessionInput).toEqual(plainInput)
    expect((await session.path()).some(entry =>
      entry.type === 'compact'
      && typeof entry.data === 'object'
      && entry.data != null
      && 'summary' in entry.data
      && (entry.data as { summary: unknown }).summary === 'summary',
    )).toBe(true)
  })
})

describe('session plugin state sync', () => {
  it('syncs agent state on checkout', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(
      entry('state', { branch: 'main' } as AgentState),
      entry('input', user('main')),
    )
    await session.fork('feature')
    await session.storage.append(
      entry('state', { branch: 'feature' } as AgentState),
      entry('input', user('feature')),
    )
    await session.checkout('main')

    const agent = createAgent({
      instructions: '',
      plugins: [session.plugin],
      runner: async () => ({ output: [] }),
      storage: session.storage,
    })
    await agent.init()

    expect(agent.state.get()).toEqual({ branch: 'main' })

    await session.checkout('feature')
    expect(agent.state.get()).toEqual({ branch: 'feature' })

    await session.checkout('main')
    expect(agent.state.get()).toEqual({ branch: 'main' })
  })

  it('syncs agent state on fork with checkout', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(entry('state', { branch: 'main' } as AgentState))

    const agent = createAgent({
      instructions: '',
      plugins: [session.plugin],
      runner: async () => ({ output: [] }),
      storage: session.storage,
    })
    await agent.init()
    expect(agent.state.get()).toEqual({ branch: 'main' })

    await session.storage.append(entry('state', { branch: 'feature' } as AgentState))
    await session.fork('feature')
    expect(agent.state.get()).toEqual({ branch: 'feature' })
  })

  it('does not sync state on fork without checkout', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(entry('state', { branch: 'main' } as AgentState))

    const agent = createAgent({
      instructions: '',
      plugins: [session.plugin],
      runner: async () => ({ output: [] }),
      storage: session.storage,
    })
    await agent.init()
    expect(agent.state.get()).toEqual({ branch: 'main' })

    await session.fork('feature', { checkout: false })
    expect(agent.state.get()).toEqual({ branch: 'main' })
    expect(await session.head()).toEqual({ name: 'main', type: 'ref' })
  })

  it('syncs agent state on rebase of the active ref', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(entry('input', user('root')))
    await session.fork('feature')
    await session.storage.append(
      entry('state', { branch: 'feature' } as AgentState),
      entry('input', user('feature')),
    )
    await session.checkout('main')
    await session.storage.append(
      entry('state', { branch: 'main' } as AgentState),
      entry('input', user('main')),
    )

    const agent = createAgent({
      instructions: '',
      plugins: [session.plugin],
      runner: async () => ({ output: [] }),
      storage: session.storage,
    })
    await agent.init()
    expect(agent.state.get()).toEqual({ branch: 'main' })

    await session.checkout('feature')
    expect(agent.state.get()).toEqual({ branch: 'feature' })

    await session.rebase('feature', 'main')
    expect(agent.state.get()).toEqual({ branch: 'feature' })
  })

  it('does not sync state when rebase does not change the active ref', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(entry('input', user('root')))
    await session.fork('feature')
    await session.storage.append(entry('state', { branch: 'feature' } as AgentState))
    await session.checkout('main')
    await session.storage.append(entry('state', { branch: 'main' } as AgentState))

    const agent = createAgent({
      instructions: '',
      plugins: [session.plugin],
      runner: async () => ({ output: [] }),
      storage: session.storage,
    })
    await agent.init()
    expect(agent.state.get()).toEqual({ branch: 'main' })

    await session.rebase('feature', 'main')
    expect(agent.state.get()).toEqual({ branch: 'main' })
  })

  it('forwards branch change events to agent channel without persisting', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(entry('state', { branch: 'main' } as AgentState))

    const events: unknown[] = []
    const agent = createAgent({
      instructions: '',
      plugins: [session.plugin],
      runner: async () => ({ output: [] }),
      storage: session.storage,
    })

    agent.subscribe('session.checkout', (event) => {
      events.push(event)
    })

    await agent.init()
    await session.checkout()

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ ref: undefined, targetId: undefined })

    const persisted = (await session.sessionStorage.read())
      .filter(entry => entry.type === 'event')
      .map(entry => entry.data)
    expect(persisted).not.toContainEqual(expect.objectContaining({ type: 'session.checkout' }))
  })

  it('rejects branch operation when state sync fails', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(entry('state', { branch: 'main' } as AgentState))
    await session.fork('feature')
    await session.storage.append(entry('state', { branch: 'feature' } as AgentState))

    const agent = createAgent({
      instructions: '',
      plugins: [session.plugin],
      runner: async () => ({ output: [] }),
      storage: session.storage,
    })
    await agent.init()

    const state = agent.state as AgentStateManager
    const originalRestore = state.restore
    state.restore = () => {
      throw new Error('sync failed')
    }

    try {
      await expect(session.checkout('main')).rejects.toBeInstanceOf(SessionError)
      expect(await session.head()).toEqual({ name: 'main', type: 'ref' })
    }
    finally {
      state.restore = originalRestore
    }
  })
})

describe('session defensive checks', () => {
  it('assertIdle ignores malformed event data', async () => {
    const session = createSession({
      defaultRef: 'main',
      sessionStorage: mem(),
    })

    await session.storage.append(entry('event', null as unknown as { turnId: string, type: 'turn.start' }))
    await session.storage.append(entry('event', 'not-an-object' as unknown as { turnId: string, type: 'turn.start' }))
    await session.storage.append(entry('event', { type: 'turn.start' } as unknown as { turnId: string, type: 'turn.start' }))
    await session.storage.append(entry('event', { turnId: 'turn-1', type: 'turn.done' }))

    await expect(session.fork('safe')).resolves.toBeUndefined()
  })
})
