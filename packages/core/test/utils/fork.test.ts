import type { AgentInput, AgentPluginOption, AgentState } from '../../src/index'

import { describe, expect, it } from 'vitest'

import { createAgent, developer, fork, mem, run, user } from '../../src/index'
import { responses } from '../../src/responses'
import { createMockFetch } from '../_shared'

const createTestAgent = (opts?: {
  input?: AgentInput[]
  instructions?: ((state: Readonly<AgentState>) => string) | string
  plugins?: AgentPluginOption[]
  state?: AgentState
}) => {
  const mock = createMockFetch()
  const agent = createAgent({
    instructions: opts?.instructions ?? 'You are a test assistant.',
    plugins: opts?.plugins,
    runner: responses({
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
    }),
    state: opts?.state,
    storage: mem(opts?.input),
  })
  return { agent, ...mock }
}

describe('fork', () => {
  it('inherits durable storage by default', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const child = await fork(agent)

    expect(await child.storage.read()).toEqual([user('hello')])
  })

  it('starts with empty storage when input is empty', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const child = await fork(agent, { input: [] })

    expect(await child.storage.read()).toEqual([])
  })

  it('starts with explicit input history', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const child = await fork(agent, { input: [user('custom')] })

    expect(await child.storage.read()).toEqual([user('custom')])
  })

  it('keeps child storage independent from parent', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const child = await fork(agent)

    await child.storage.append(user('child-only'))

    expect(await agent.storage.read()).toEqual([user('hello')])
    expect(await child.storage.read()).toEqual([user('hello'), user('child-only')])
  })

  it('keeps child state independent from parent', async () => {
    const { agent } = createTestAgent({ state: { agentName: 'parent' } })
    const child = await fork(agent, {
      state: parent => ({ ...parent, agentName: 'child' }),
    })

    expect(agent.state.get()).toEqual({ agentName: 'parent' })
    expect(child.state.get()).toEqual({ agentName: 'child' })
  })

  it('inherits instructions, runner, and plugins by default', async () => {
    const plugin = { name: 'test-plugin' }
    const { agent } = createTestAgent({ instructions: 'parent instructions', plugins: [plugin] })

    const child = await fork(agent)

    expect(child.instructions).toBe('parent instructions')
    expect(child.runner).toBe(agent.runner)
    expect(child.plugins).toEqual([plugin])
  })

  it('applies overrides', async () => {
    const { agent } = createTestAgent({ instructions: 'parent' })
    const customStorage = mem<AgentInput>([developer('custom')])

    const child = await fork(agent, {
      instructions: 'child',
      state: { agentName: 'child' },
      storage: customStorage,
    })

    expect(child.instructions).toBe('child')
    expect(await child.storage.read()).toEqual([developer('custom')])
    expect(child.state.get()).toEqual({ agentName: 'child' })
  })

  it('uses a custom storage factory that receives the cloned input', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const factoryInput: AgentInput[] = []

    const child = await fork(agent, {
      storage: async (snapshot) => {
        factoryInput.push(...snapshot)
        return mem<AgentInput>([developer('factory')])
      },
    })

    expect(factoryInput).toEqual([user('hello')])
    expect(await child.storage.read()).toEqual([developer('factory')])
  })

  it('initializes eagerly when init is true', async () => {
    const calls: string[] = []
    const { agent } = createTestAgent({
      plugins: [{
        init: async () => { calls.push('init') },
        name: 'p1',
      }],
    })

    await fork(agent, { init: true })

    expect(calls).toEqual(['init'])
  })

  it('does not initialize eagerly by default', async () => {
    const calls: string[] = []
    const { agent } = createTestAgent({
      plugins: [{
        init: async () => { calls.push('init') },
        name: 'p1',
      }],
    })

    await fork(agent)

    expect(calls).toEqual([])
  })

  it('does not share parent subscribers', async () => {
    const { agent } = createTestAgent()
    const parentEvents: string[] = []
    const childEvents: string[] = []

    agent.subscribe('apeira', (event) => {
      parentEvents.push(event.type)
    })

    const child = await fork(agent)
    child.subscribe('apeira', (event) => {
      childEvents.push(event.type)
    })

    // Trigger a turn on the child only.
    const stream = run(child, user('hi'))
    const reader = stream.getReader()
    while (!(await reader.read()).done) {
      // Consume the stream until it closes.
    }

    expect(parentEvents).toEqual([])
    expect(childEvents.length).toBeGreaterThan(0)
  })
})
