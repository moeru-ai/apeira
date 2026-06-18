import type { AgentEntry, AgentInput, AgentPluginOption, AgentState } from '../../src/index'

import { describe, expect, it } from 'vitest'

import { createAgent, developer, entry, fork, mem, run, user } from '../../src/index'
import { responses } from '../../src/responses'
import { createMockFetch } from '../_shared'

const createTestAgent = (opts?: {
  initialState?: AgentState
  input?: AgentInput[]
  instructions?: ((state: Readonly<AgentState>) => string) | string
  plugins?: AgentPluginOption[]
}) => {
  const mock = createMockFetch()
  const agent = createAgent({
    initialState: opts?.initialState,
    instructions: opts?.instructions ?? 'You are a test assistant.',
    plugins: opts?.plugins,
    runner: responses({
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
    }),
    storage: mem(opts?.input),
  })
  return { agent, ...mock }
}

describe('fork', () => {
  it('inherits durable storage by default', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const child = await fork(agent)

    expect(await child.storage.read()).toEqual([
      expect.objectContaining({ data: user('hello'), type: 'input' }),
    ])
  })

  it('starts with empty storage when storage is empty', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const child = await fork(agent, { storage: mem([]) })

    expect(await child.storage.read()).toEqual([])
  })

  it('starts with explicit storage history', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const child = await fork(agent, { storage: mem([user('custom')]) })

    expect(await child.storage.read()).toEqual([
      expect.objectContaining({ data: user('custom'), type: 'input' }),
    ])
  })

  it('keeps child storage independent from parent', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const child = await fork(agent)

    await child.storage.append(entry('input', user('child-only')))

    expect(await agent.storage.read()).toEqual([
      expect.objectContaining({ data: user('hello'), type: 'input' }),
    ])
    expect(await child.storage.read()).toEqual([
      expect.objectContaining({ data: user('hello'), type: 'input' }),
      expect.objectContaining({ data: user('child-only'), type: 'input' }),
    ])
  })

  it('keeps child state independent from parent', async () => {
    const { agent } = createTestAgent({ initialState: { agentName: 'parent' } })
    const child = await fork(agent, {
      initialState: parent => ({ ...parent, agentName: 'child' }),
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
    const customStorage = mem([developer('custom')])

    const child = await fork(agent, {
      initialState: { agentName: 'child' },
      instructions: 'child',
      storage: customStorage,
    })

    expect(child.instructions).toBe('child')
    expect(await child.storage.read()).toEqual([
      expect.objectContaining({ data: developer('custom'), type: 'input' }),
    ])
    expect(child.state.get()).toEqual({ agentName: 'child' })
  })

  it('uses a custom storage factory that receives the cloned parent history', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    const factoryInput: AgentEntry[] = []

    const child = await fork(agent, {
      storage: async (snapshot) => {
        factoryInput.push(...snapshot)
        return mem([developer('factory')])
      },
    })

    expect(factoryInput).toEqual([
      expect.objectContaining({ data: user('hello'), type: 'input' }),
    ])
    expect(await child.storage.read()).toEqual([
      expect.objectContaining({ data: developer('factory'), type: 'input' }),
    ])
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

  it('keeps custom initialState after init even when parent storage has a different state', async () => {
    const { agent } = createTestAgent({
      initialState: { contextLength: 8_000 },
      input: [user('hello')],
    })
    agent.state.update({ contextLength: 16_000 })

    const child = await fork(agent, {
      init: true,
      initialState: { contextLength: 24_000 },
    })

    expect(child.state.get()).toEqual({ contextLength: 24_000 })
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
