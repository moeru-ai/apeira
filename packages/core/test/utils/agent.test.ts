import type { Tool } from '@xsai/shared-chat'

import type { Agent, AgentEntry, AgentEvent, AgentInput, AgentPluginOption, AgentState, AgentStorage } from '../../src/index'

import { stepCountAtLeast } from '@xsai-ext/responses'
import { describe, expect, it, vi } from 'vitest'

import { createAgent, developer, entry, mem, run, user } from '../../src/index'
import { responses } from '../../src/responses'
import { createMockFetch, sleep } from '../_shared'

const createTestAgent = (opts?: {
  delayMs?: number
  input?: AgentInput[]
  instructions?: ((state: Readonly<AgentState>) => string) | string
  plugins?: AgentPluginOption[]
  state?: AgentState
}) => {
  const mock = createMockFetch({ delayMs: opts?.delayMs ?? 0 })
  const agent = createAgent({
    instructions: opts?.instructions ?? 'You are a test assistant.',
    plugins: opts?.plugins,
    runner: responses({
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
      stopWhen: stepCountAtLeast(1),
    }),
    state: opts?.state,
    storage: mem(opts?.input),
  })
  return { agent, ...mock }
}

describe('createAgent', () => {
  it('creates an agent with initial input', async () => {
    const { agent } = createTestAgent({ input: [user('hello')] })
    expect(await agent.storage.read()).toEqual([
      expect.objectContaining({ data: user('hello'), type: 'input' }),
    ])
  })

  it('returns empty input when none provided', async () => {
    const { agent } = createTestAgent()
    expect(await agent.storage.read()).toEqual([])
  })

  it('returns the current agent state', () => {
    const { agent } = createTestAgent({ state: { contextLength: 8_000 } })

    expect(agent.state.get()).toEqual({ contextLength: 8_000 })
  })

  it('replaces input with a cloned value', async () => {
    const { agent } = createTestAgent({ input: [user('old')] })
    const nextInput = [user('new')]

    await agent.storage.clear()
    await agent.storage.append(...nextInput)
    nextInput[0] = user('mutated')

    expect(await agent.storage.read()).toEqual([user('new')])
  })

  it('replaces nested state patches with cloned values', () => {
    const { agent } = createTestAgent({
      state: {
        nested: { first: true },
      } as AgentState,
    })
    const patch = {
      nested: { second: true },
    } as Partial<AgentState>
    const mutablePatch = patch as { nested: { second: boolean } }

    agent.state.update(patch)
    mutablePatch.nested.second = false

    expect(agent.state.get()).toEqual({
      nested: { second: true },
    })
  })

  it('merges state patches', () => {
    const { agent } = createTestAgent({ state: { contextLength: 8_000 } })

    agent.state.update({ contextLength: 16_000 })
    expect(agent.state.get()).toEqual({ contextLength: 16_000 })
  })
})

describe('plugin lifecycle', () => {
  it('calls plugin init in parallel and stop in reverse order', async () => {
    const calls: string[] = []
    const { agent } = createTestAgent({
      plugins: [
        {
          init: async () => { calls.push('p1 init') },
          name: 'p1',
          stop: async () => { calls.push('p1 stop') },
        },
        {
          init: async () => { calls.push('p2 init') },
          name: 'p2',
          stop: async () => { calls.push('p2 stop') },
        },
      ],
    })
    await agent.init()
    expect(calls).toEqual(['p1 init', 'p2 init'])
    await agent.stop()
    expect(calls).toEqual(['p1 init', 'p2 init', 'p2 stop', 'p1 stop'])
  })
})

describe('plugin hooks', () => {
  it('extends instructions from plugins', async () => {
    const { agent, instructions } = createTestAgent({
      instructions: 'base',
      plugins: [
        { extendInstructions: () => 'ext1', name: 'p1' },
        { extendInstructions: () => 'ext2', name: 'p2' },
      ],
    })
    for await (const event of run(agent, user('hi')))
      void event
    expect(instructions[0]).toBe('base\n\next1\n\next2')
  })

  it('skips null and empty instruction extensions', async () => {
    const { agent, instructions } = createTestAgent({
      instructions: 'base',
      plugins: [
        { extendInstructions: () => '', name: 'p1' },
        { extendInstructions: () => null as unknown as string, name: 'p2' },
        { extendInstructions: () => 'real', name: 'p3' },
      ],
    })
    for await (const event of run(agent, user('hi')))
      void event
    expect(instructions[0]).toBe('base\n\nreal')
  })

  it('extends tools from plugins', async () => {
    const tool: Tool = {
      execute: async () => 'result',
      function: { name: 'test-tool', parameters: {} },
      type: 'function',
    }
    const { agent, bodies } = createTestAgent({
      plugins: [{ extendTools: () => [tool], name: 'p1' }],
    })
    for await (const event of run(agent, user('hi')))
      void event
    expect(bodies[0]?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'test-tool', type: 'function' }),
    ]))
  })

  it('calls onFinish and onStepFinish hooks', async () => {
    const calls: string[] = []
    const { agent } = createTestAgent({
      plugins: [
        {
          name: 'p1',
          onFinish: async () => { calls.push('p1 onFinish') },
          onStepFinish: async () => { calls.push('p1 onStepFinish') },
        },
      ],
    })
    for await (const event of run(agent, user('hi')))
      void event
    expect(calls).toContain('p1 onFinish')
    expect(calls).toContain('p1 onStepFinish')
  })
})

describe('plugin normalization', () => {
  it('filters out false, null, and undefined plugins', async () => {
    const calls: string[] = []
    const { agent } = createTestAgent({
      plugins: [
        false,
        null,
        undefined,
        { init: () => { calls.push('p1') }, name: 'p1' },
      ] as AgentPluginOption[],
    })
    await agent.init()
    expect(calls).toEqual(['p1'])
  })

  it('flattens nested plugin arrays', async () => {
    const calls: string[] = []
    const { agent } = createTestAgent({
      plugins: [
        [{ init: () => { calls.push('p1') }, name: 'p1' }],
        { init: () => { calls.push('p2') }, name: 'p2' },
      ] as AgentPluginOption[],
    })
    await agent.init()
    expect(calls).toEqual(['p1', 'p2'])
  })

  it('sorts plugins by enforce: pre < default < post', async () => {
    const calls: string[] = []
    const { agent } = createTestAgent({
      plugins: [
        { enforce: 'post', init: () => { calls.push('post') }, name: 'post' },
        { enforce: 'pre', init: () => { calls.push('pre') }, name: 'pre' },
        { init: () => { calls.push('default') }, name: 'default' },
      ],
    })
    await agent.init()
    expect(calls).toEqual(['pre', 'default', 'post'])
  })
})

describe('channel', () => {
  it('emits and subscribes to events', async () => {
    const { agent } = createTestAgent()
    const received: unknown[] = []
    const unsubscribe = agent.subscribe('test', (event) => {
      received.push(event)
    })
    await agent.emit('test', { ok: true })
    unsubscribe()
    expect(received).toEqual([{ ok: true }])
  })

  it('does not receive events after unsubscribe', async () => {
    const { agent } = createTestAgent()
    const received: unknown[] = []
    const unsubscribe = agent.subscribe('test', (event) => {
      received.push(event)
    })
    unsubscribe()
    await agent.emit('test', { ok: true })
    expect(received).toEqual([])
  })
})

describe('turn lifecycle', () => {
  it('returns turn events in correct order', async () => {
    const { agent } = createTestAgent()
    const events: AgentEvent[] = []
    for await (const event of run(agent, user('hi'))) {
      events.push(event)
    }
    const types = events.map(e => e.type)
    expect(types).toContain('turn.start')
    expect(types).toContain('turn.done')
  })

  it('assigns turnId to all events', async () => {
    const { agent } = createTestAgent()
    const events: AgentEvent[] = []
    for await (const event of run(agent, user('hi'))) {
      events.push(event)
    }
    const turnId = events.find(e => e.type === 'turn.start')?.turnId
    expect(turnId).toBeDefined()
    for (const event of events) {
      expect(event.turnId).toBe(turnId)
    }
  })

  it('aborts turn when send signal is already aborted', async () => {
    const { agent } = createTestAgent()
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', (event) => {
      events.push(event)
    })
    const controller = new AbortController()
    controller.abort('already aborted')

    const turnId = agent.send(user('hi'), { signal: controller.signal })
    await sleep(20)
    unsubscribe()

    const turnEvents = events.filter(e => e.turnId === turnId)
    expect(turnEvents.map(e => e.type)).toContain('turn.aborted')
    expect(turnEvents.at(-1)).toMatchObject({
      reason: 'already aborted',
      type: 'turn.aborted',
    })
  })
})

describe('queue', () => {
  it('processes multiple sends in FIFO order', async () => {
    const { agent, inputs } = createTestAgent()
    const events1: AgentEvent[] = []
    const events2: AgentEvent[] = []

    let id1: string
    let id2: string
    const unsubscribe = agent.subscribe('apeira', (event) => {
      if (event.turnId === id1)
        events1.push(event)
      if (event.turnId === id2)
        events2.push(event)
    })

    id1 = agent.send(user('first'))
    await sleep(20)
    id2 = agent.send(user('second'))
    expect(id1).not.toBe(id2)

    await sleep(50)
    unsubscribe()

    expect(events1.at(-1)?.type).toBe('turn.done')
    expect(events2.at(-1)?.type).toBe('turn.done')
    expect(inputs[0]).toEqual([user('first')])
    expect(inputs[1]).toEqual([user('first'), { content: [{ text: 'hello', type: 'output_text' }], role: 'assistant', type: 'message' }, user('second')])
  })

  it('drains input into active turn instead of queueing new turn', async () => {
    const { agent } = createTestAgent({ delayMs: 10 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', (event) => {
      events.push(event)
    })

    const turnId = agent.send(user('Initial turn.'))

    await sleep(15)

    const sameTurnId = agent.send(user('Follow up.'))
    expect(sameTurnId).toBe(turnId)

    await sleep(80)
    unsubscribe()

    const turnEvents = events.filter(e => e.turnId === turnId)
    expect(turnEvents.some(e => e.type === 'turn.input_queued')).toBe(true)
    expect(turnEvents.some(e => e.type === 'turn.input_drained')).toBe(true)
    expect(turnEvents.at(-1)?.type).toBe('turn.done')
  })

  it('aborts active turn', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', (event) => {
      events.push(event)
    })

    const turnId = agent.send(user('hi'))
    await sleep(10)
    agent.abort('test abort')

    await sleep(150)
    unsubscribe()

    const turnEvents = events.filter(e => e.turnId === turnId)
    expect(turnEvents.some(e => e.type === 'turn.aborted')).toBe(true)
  })

  it('interrupt returns the active turn id and records a boundary for the next turn', async () => {
    const { agent, inputs } = createTestAgent({ delayMs: 100 })
    const boundary = developer([
      '<turn_aborted>',
      'The previous turn was interrupted on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.',
      '</turn_aborted>',
    ].join('\n'))

    const id = agent.send(user('hi'))
    await sleep(10)

    expect(await agent.interrupt('test')).toBe(id)
    expect(await agent.interrupt('test again')).toBeUndefined()

    await sleep(20)

    expect(await agent.storage.read()).toContainEqual(expect.objectContaining({ data: boundary, type: 'input' }))

    agent.send(user('next'))
    await sleep(150)

    expect(inputs.at(-1)).toEqual([boundary, user('next')])
  })

  it('resets pending input and aborts active turn', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', (event) => {
      events.push(event)
    })

    agent.send(user('first'))
    await sleep(10)
    agent.send(user('second'))
    await agent.reset()

    await sleep(150)
    unsubscribe()

    expect(events.some(e => e.type === 'turn.aborted' && e.reason === 'reset')).toBe(true)
  })

  it('waits for an active append before resetting the storage', async () => {
    let releaseAppend!: () => void
    let signalAppend!: () => void
    const appendBlocked = new Promise<void>(resolve => releaseAppend = resolve)
    const appendStarted = new Promise<void>(resolve => signalAppend = resolve)
    const items: AgentEntry[] = []
    const storage: AgentStorage<AgentEntry> = {
      append: async (...next) => {
        signalAppend()
        await appendBlocked
        items.push(...next)
      },
      clear: () => { items.length = 0 },
      read: () => items,
      reset: () => { items.length = 0 },
    }
    const agent = createAgent({
      instructions: 'test',
      runner: async () => ({ output: [] }),
      storage,
    })

    agent.send(user('old'))
    await appendStarted
    const clearing = agent.reset()
    releaseAppend()
    await clearing

    expect(items.some(item => item.type === 'input')).toBe(false)
  })

  it('restores initial input and state and emits one reset event', async () => {
    const { agent } = createTestAgent({
      input: [user('initial')],
      state: { contextLength: 8_000 },
    })
    const events: AgentEvent[] = []
    agent.subscribe('apeira', (event) => {
      events.push(event)
    })

    await agent.storage.clear()
    await agent.storage.append(entry('input', user('changed')))
    agent.state.update({ contextLength: 16_000 })
    await agent.reset()

    const entries = await agent.storage.read()
    expect(entries).toContainEqual(expect.objectContaining({ data: user('initial'), type: 'input' }))
    expect(entries).toContainEqual(expect.objectContaining({ data: { contextLength: 8_000 }, type: 'state' }))
    expect(entries.some(e =>
      e.type === 'event'
      && (e as AgentEntry<'event'>).data.type === 'agent.reset',
    )).toBe(true)
    expect(agent.state.get()).toEqual({ contextLength: 8_000 })
    expect(events.filter(event => event.type === 'agent.reset')).toHaveLength(1)
    expect(events.find(event => event.type === 'agent.reset')?.turnId).toBeTruthy()
  })

  it('clears turns queued from a completed-turn listener', async () => {
    const { agent, inputs } = createTestAgent()

    agent.subscribe('apeira', async (event) => {
      if (event.type !== 'turn.done')
        return
      agent.send(user('queued'))
      await agent.reset()
    })

    agent.send(user('first'))
    await sleep(50)

    expect(inputs).toHaveLength(1)
  })

  it('uses reset state for a turn sent immediately after clear', async () => {
    const { agent, instructions } = createTestAgent({
      instructions: state => String(state.contextLength),
      state: { contextLength: 8_000 },
    })

    agent.state.update({ contextLength: 16_000 })
    await agent.reset()
    agent.send(user('after clear'))
    await sleep(50)

    expect(instructions).toEqual(['8000'])
  })

  it('aborts turn when send signal is aborted', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', (event) => {
      events.push(event)
    })

    const controller = new AbortController()
    const turnId = agent.send(user('hi'), { signal: controller.signal })
    await sleep(10)
    controller.abort('user abort')

    await sleep(150)
    unsubscribe()

    expect(events.filter(e => e.turnId === turnId).some(e => e.type === 'turn.aborted')).toBe(true)
  })

  it('unsubscribes when run send throws synchronously', async () => {
    const unsubscribe = vi.fn()
    const error = new Error('send failed')
    // eslint-disable-next-line @masknet/type-no-force-cast-via-top-type
    const agent = {
      abort: vi.fn(),
      clear: vi.fn(),
      emit: vi.fn(),
      getActiveTurnId: vi.fn(),
      init: vi.fn(),
      interrupt: vi.fn(),
      send: vi.fn(() => {
        throw error
      }),
      stop: vi.fn(),
      storage: { append: vi.fn(), clear: vi.fn(), read: vi.fn(() => []), reset: vi.fn() },
      subscribe: vi.fn(() => unsubscribe),
    } as unknown as Agent

    const reader = run(agent, user('hi')).getReader()

    await expect(reader.read()).rejects.toThrow(error)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('filters run stream events by turn id', async () => {
    let listener: ((event: AgentEvent) => void) | undefined
    const unsubscribe = vi.fn()
    // eslint-disable-next-line @masknet/type-no-force-cast-via-top-type
    const agent = {
      abort: vi.fn(),
      clear: vi.fn(),
      emit: vi.fn(),
      getActiveTurnId: vi.fn(() => undefined),
      init: vi.fn(),
      interrupt: vi.fn(),
      send: vi.fn(() => {
        listener?.({ turnId: 'other-turn', type: 'turn.queued' })
        queueMicrotask(() => {
          listener?.({ turnId: 'target-turn', type: 'turn.start' })
          listener?.({ turnId: 'other-turn', type: 'turn.done' })
          listener?.({ turnId: 'target-turn', type: 'turn.done' })
        })
        return 'target-turn'
      }),
      stop: vi.fn(),
      storage: { append: vi.fn(), clear: vi.fn(), read: vi.fn(() => []), reset: vi.fn() },
      subscribe: vi.fn((_channel: string, next: unknown) => {
        listener = next as (event: AgentEvent) => void
        return unsubscribe
      }),
    } as unknown as Agent

    const reader = run(agent, user('hi')).getReader()
    const first = await reader.read()
    const second = await reader.read()
    const third = await reader.read()

    expect(first.value?.type).toBe('turn.start')
    expect(second.value?.type).toBe('turn.done')
    expect(third.done).toBe(true)
    expect(first.value?.turnId).toBe('target-turn')
    expect(second.value?.turnId).toBe('target-turn')
  })

  it('waits for active turn before sending run input', async () => {
    let listener: ((event: AgentEvent) => void) | undefined
    const unsubscribe = vi.fn()
    let activeTurnId: string | undefined = 'active-turn'
    // eslint-disable-next-line @masknet/type-no-force-cast-via-top-type
    const agent = {
      abort: vi.fn(),
      clear: vi.fn(),
      emit: vi.fn(),
      getActiveTurnId: vi.fn(() => activeTurnId),
      init: vi.fn(),
      interrupt: vi.fn(),
      send: vi.fn(() => {
        queueMicrotask(() => {
          listener?.({ turnId: 'new-turn', type: 'turn.start' })
          listener?.({ turnId: 'other-turn', type: 'turn.done' })
          listener?.({ turnId: 'new-turn', type: 'turn.done' })
        })
        return 'new-turn'
      }),
      stop: vi.fn(),
      storage: { append: vi.fn(), clear: vi.fn(), read: vi.fn(() => []), reset: vi.fn() },
      subscribe: vi.fn((_channel: string, next: unknown) => {
        listener = next as (event: AgentEvent) => void
        return unsubscribe
      }),
    } as unknown as Agent

    const reader = run(agent, user('hi')).getReader()
    expect(agent.send).not.toHaveBeenCalled()

    activeTurnId = undefined
    listener?.({ turnId: 'active-turn', type: 'turn.done' })

    const first = await reader.read()
    const second = await reader.read()
    const third = await reader.read()

    expect(agent.send).toHaveBeenCalledOnce()
    expect(first.value?.type).toBe('turn.start')
    expect(second.value?.type).toBe('turn.done')
    expect(third.done).toBe(true)
    expect(first.value?.turnId).toBe('new-turn')
    expect(second.value?.turnId).toBe('new-turn')
  })
})

describe('wait and isIdle', () => {
  it('reports idle for a fresh agent', () => {
    const { agent } = createTestAgent()
    expect(agent.isIdle()).toBe(true)
  })

  it('reports not idle while a turn is active', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    agent.send(user('hi'))
    await sleep(10)

    expect(agent.isIdle()).toBe(false)

    await agent.wait()
    expect(agent.isIdle()).toBe(true)
  })

  it('resolves immediately when already idle', async () => {
    const { agent } = createTestAgent()
    await expect(agent.wait()).resolves.toBeUndefined()
  })

  it('waits for a single turn to finish', async () => {
    const { agent } = createTestAgent({ delayMs: 50 })
    agent.send(user('hi'))
    await expect(agent.wait()).resolves.toBeUndefined()
    expect(agent.isIdle()).toBe(true)
  })

  it('waits for multiple queued turns to finish', async () => {
    const { agent } = createTestAgent({ delayMs: 30 })
    agent.send(user('first'))
    agent.send(user('second'))
    agent.send(user('third'))

    await expect(agent.wait()).resolves.toBeUndefined()
    expect(agent.isIdle()).toBe(true)
  })

  it('waits for pending input to drain', async () => {
    const { agent } = createTestAgent({ delayMs: 20 })
    agent.send(user('first'))
    await sleep(25)
    agent.send(user('second'))

    expect(agent.isIdle()).toBe(false)
    await expect(agent.wait()).resolves.toBeUndefined()
    expect(agent.isIdle()).toBe(true)
  })

  it('rejects when signal is already aborted', async () => {
    const { agent } = createTestAgent()
    const controller = new AbortController()
    controller.abort()

    await expect(agent.wait({ signal: controller.signal })).rejects.toThrow(DOMException)
  })

  it('rejects when signal is aborted while waiting', async () => {
    const { agent } = createTestAgent({ delayMs: 200 })
    agent.send(user('hi'))
    await sleep(10)

    const controller = new AbortController()
    const waiting = agent.wait({ signal: controller.signal })
    controller.abort()

    await expect(waiting).rejects.toThrow(DOMException)
  })

  it('resolves after reset clears the queue', async () => {
    const { agent } = createTestAgent({ delayMs: 200 })
    agent.send(user('hi'))
    await sleep(10)

    const waiting = agent.wait()
    await agent.reset()

    await expect(waiting).resolves.toBeUndefined()
    expect(agent.isIdle()).toBe(true)
  })

  it('supports multiple concurrent waiters', async () => {
    const { agent } = createTestAgent({ delayMs: 50 })
    agent.send(user('hi'))
    await sleep(10)

    const waiting1 = agent.wait()
    const waiting2 = agent.wait()

    await expect(Promise.all([waiting1, waiting2])).resolves.toEqual([undefined, undefined])
    expect(agent.isIdle()).toBe(true)
  })

  it('resolves even when a turn fails', async () => {
    const agent = createAgent({
      instructions: 'test',
      runner: async () => {
        throw new Error('runner failed')
      },
    })

    agent.send(user('hi'))
    await expect(agent.wait()).resolves.toBeUndefined()
    expect(agent.isIdle()).toBe(true)
  })

  it('does not resolve before the terminal event is emitted', async () => {
    const { agent } = createTestAgent({ delayMs: 30 })
    let resolved = false

    const unsubscribe = agent.subscribe('apeira', (event) => {
      if (event.type !== 'turn.done')
        return
      expect(resolved).toBe(false)
    })

    agent.send(user('hi'))
    const waiting = agent.wait().then(() => {
      resolved = true
    })
    await waiting
    unsubscribe()

    expect(agent.isIdle()).toBe(true)
  })
})
