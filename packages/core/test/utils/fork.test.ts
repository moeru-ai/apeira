import type { AgentEntry, AgentInput, AgentPluginOption, AgentState, Tool } from '../../src/index'

import { describe, expect, it } from 'vitest'

import { createAgent, developer, entry, fork, mem, run, user } from '../../src/index'
import { responses } from '../../src/responses'
import { createMockFetch } from '../_shared'

const createTestAgent = (opts?: {
  initialState?: AgentState
  input?: AgentInput[]
  instructions?: ((state: Readonly<AgentState>) => string) | string
  plugins?: AgentPluginOption[]
  tools?: readonly Tool[]
}) => {
  const mock = createMockFetch()
  const agent = createAgent({
    initialInput: opts?.input,
    initialState: opts?.initialState,
    instructions: opts?.instructions ?? 'You are a test assistant.',
    plugins: opts?.plugins,
    runner: responses({
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
    }),
    tools: opts?.tools,
  })
  return { agent, ...mock }
}

describe('fork', () => {
  it('inherits durable storage by default', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    await agent.init()
    const child = await fork(agent)

    expect(await child.storage.read()).toEqual([
      expect.objectContaining({ data: user('hello'), type: 'input' }),
    ])
  })

  it('does not inherit entries when disabled', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    await agent.init()
    const child = await fork(agent, { inheritEntries: false })

    expect(await child.storage.read()).toEqual([])
  })

  it('inherits and transforms initial input', async () => {
    const { agent } = createTestAgent({ input: [user('parent')] })
    const inherited = await fork(agent, { inheritEntries: false, init: true })
    const transformed = await fork(agent, {
      inheritEntries: false,
      init: true,
      initialInput: parent => [...parent, developer('child')],
    })

    expect(inherited.initialInput).toEqual([user('parent')])
    expect(await inherited.storage.read()).toEqual([
      expect.objectContaining({ data: user('parent'), type: 'input' }),
    ])
    expect(transformed.initialInput).toEqual([user('parent'), developer('child')])
  })

  it('starts with explicit storage history', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    await agent.init()
    const storage = mem()
    await storage.append(entry('input', user('custom')))
    const child = await fork(agent, { inheritEntries: false, storage })

    expect(await child.storage.read()).toEqual([
      expect.objectContaining({ data: user('custom'), type: 'input' }),
    ])
  })

  it('keeps child storage independent from parent', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    await agent.init()
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

  it('inherits and transforms initial state', async () => {
    const { agent } = createTestAgent({ initialState: { agentName: 'parent' } })
    const child = await fork(agent, {
      initialState: parent => ({ ...parent, agentName: 'child' }),
    })

    expect(agent.initialState).toEqual({ agentName: 'parent' })
    expect(child.initialState).toEqual({ agentName: 'child' })
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

  it('inherits and overrides tools', async () => {
    const parentTool: Tool = {
      execute: async () => 'parent',
      function: { name: 'parent-tool', parameters: {} },
      type: 'function',
    }
    const childTool: Tool = {
      execute: async () => 'child',
      function: { name: 'child-tool', parameters: {} },
      type: 'function',
    }
    const { agent } = createTestAgent({ tools: [parentTool] })

    const inherited = await fork(agent)
    const overridden = await fork(agent, { tools: [childTool] })

    expect(inherited.tools).toEqual([parentTool])
    expect(overridden.tools).toEqual([childTool])
  })

  it('applies overrides', async () => {
    const { agent } = createTestAgent({ instructions: 'parent' })
    const customStorage = mem()
    await customStorage.append(entry('input', developer('custom')))

    const child = await fork(agent, {
      inheritEntries: false,
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

  it('appends inherited entries to custom storage', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    await agent.init()
    const storage = mem()
    await storage.append(entry('input', developer('custom')))
    const child = await fork(agent, { storage })

    expect(await child.storage.read()).toEqual([
      expect.objectContaining({ data: developer('custom'), type: 'input' }),
      expect.objectContaining({ data: user('hello'), type: 'input' }),
    ])
  })

  it('rejects inheriting entries into the parent storage', async () => {
    const { agent } = createTestAgent()

    await expect(fork(agent, { storage: agent.storage })).rejects.toThrow(
      'Cannot inherit entries into the parent storage',
    )
  })

  it('allows sharing parent storage when entry inheritance is disabled', async () => {
    const { agent } = createTestAgent()
    const child = await fork(agent, {
      inheritEntries: false,
      storage: agent.storage,
    })

    expect(child.storage).toBe(agent.storage)
  })

  it('resets inherited entries to initial baselines', async () => {
    const { agent } = createTestAgent({
      initialState: { contextLength: 8_000 },
      input: [user('initial')],
    })
    await agent.init()
    await agent.storage.append(entry('input', user('later')))
    agent.state.update({ contextLength: 16_000 })
    await Promise.resolve()
    const child = await fork(agent)

    await child.init()
    expect(child.state.get()).toEqual({ contextLength: 16_000 })
    await child.reset()

    const inputs = (await child.storage.read())
      .filter((item): item is AgentEntry<'input'> => item.type === 'input')
      .map(item => item.data)
    expect(inputs).toEqual([user('initial')])
    expect(child.state.get()).toEqual({ contextLength: 8_000 })
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

  it('restores inherited state entries over the child initial state', async () => {
    const { agent } = createTestAgent({
      initialState: { contextLength: 8_000 },
      input: [user('hello')],
    })
    agent.state.update({ contextLength: 16_000 })
    await Promise.resolve()

    const child = await fork(agent, {
      init: true,
      initialState: { contextLength: 24_000 },
    })

    expect(child.initialState).toEqual({ contextLength: 24_000 })
    expect(child.state.get()).toEqual({ contextLength: 16_000 })
  })

  it('uses child initial state when entries are not inherited', async () => {
    const { agent } = createTestAgent({
      initialState: { contextLength: 8_000 },
    })
    agent.state.update({ contextLength: 16_000 })

    const child = await fork(agent, {
      inheritEntries: false,
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
