import type { Tool } from '@xsai/shared-chat'

import type { Agent, AgentEvent, AgentPluginOption, AgentState, ItemParam } from '../../src/index'

import { stepCountAtLeast } from '@xsai-ext/responses'
import { describe, expect, it, vi } from 'vitest'

import { createAgent, run } from '../../src/index'
import { assistantMessage, createMockFetch, message, sleep } from '../_shared'

const createTestAgent = (opts?: {
  delayMs?: number
  input?: ItemParam[]
  instructions?: ((state: AgentState) => string) | string
  plugins?: AgentPluginOption[]
  state?: AgentState
}) => {
  const mock = createMockFetch({ delayMs: opts?.delayMs ?? 0 })
  const agent = createAgent({
    input: opts?.input,
    instructions: opts?.instructions ?? 'You are a test assistant.',
    options: {
      apiKey: 'test',
      baseURL: 'https://test',
      fetch: mock.fetch,
      model: 'test-model',
      stopWhen: stepCountAtLeast(1),
    },
    plugins: opts?.plugins,
    state: opts?.state,
  })
  return { agent, ...mock }
}

describe('createAgent', () => {
  it('creates an agent with initial input', () => {
    const { agent } = createTestAgent({ input: [message('hello')] })
    expect(agent.getInput()).toEqual([message('hello')])
  })

  it('returns empty input when none provided', () => {
    const { agent } = createTestAgent()
    expect(agent.getInput()).toEqual([])
  })

  it('returns a cloned agent state', () => {
    const { agent } = createTestAgent({ state: { contextLength: 8_000 } })
    const state = agent.getState()

    state.contextLength = 16_000

    expect(agent.getState()).toEqual({ contextLength: 8_000 })
  })

  it('replaces input with a cloned value', () => {
    const { agent } = createTestAgent({ input: [message('old')] })
    const nextInput = [message('new')]

    agent.setInput(nextInput)
    nextInput[0] = message('mutated')

    expect(agent.getInput()).toEqual([message('new')])
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
    for await (const event of run(agent, message('hi')))
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
    for await (const event of run(agent, message('hi')))
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
    for await (const event of run(agent, message('hi')))
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
    for await (const event of run(agent, message('hi')))
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
    const unsubscribe = agent.subscribe('test', event => received.push(event))
    agent.emit('test', { ok: true })
    unsubscribe()
    expect(received).toEqual([{ ok: true }])
  })

  it('does not receive events after unsubscribe', async () => {
    const { agent } = createTestAgent()
    const received: unknown[] = []
    const unsubscribe = agent.subscribe('test', event => received.push(event))
    unsubscribe()
    agent.emit('test', { ok: true })
    expect(received).toEqual([])
  })
})

describe('turn lifecycle', () => {
  it('returns turn events in correct order', async () => {
    const { agent } = createTestAgent()
    const events: AgentEvent[] = []
    for await (const event of run(agent, message('hi'))) {
      events.push(event)
    }
    const types = events.map(e => e.type)
    expect(types).toContain('turn.start')
    expect(types).toContain('turn.done')
  })

  it('assigns turnId to all events', async () => {
    const { agent } = createTestAgent()
    const events: AgentEvent[] = []
    for await (const event of run(agent, message('hi'))) {
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
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))
    const controller = new AbortController()
    controller.abort('already aborted')

    const turnId = agent.send(message('hi'), { signal: controller.signal })
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

    id1 = agent.send(message('first'))
    await sleep(20)
    id2 = agent.send(message('second'))
    expect(id1).not.toBe(id2)

    await sleep(50)
    unsubscribe()

    expect(events1.at(-1)?.type).toBe('turn.done')
    expect(events2.at(-1)?.type).toBe('turn.done')
    expect(inputs[0]).toEqual([message('first')])
    expect(inputs[1]).toEqual([message('first'), assistantMessage('hello'), message('second')])
  })

  it('drains input into active turn instead of queueing new turn', async () => {
    const { agent } = createTestAgent({ delayMs: 10 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))

    const turnId = agent.send(message('Initial turn.'))

    await sleep(15)

    const sameTurnId = agent.send(message('Follow up.'))
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
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))

    const turnId = agent.send(message('hi'))
    await sleep(10)
    agent.abort('test abort')

    await sleep(150)
    unsubscribe()

    const turnEvents = events.filter(e => e.turnId === turnId)
    expect(turnEvents.some(e => e.type === 'turn.aborted')).toBe(true)
  })

  it('interrupt returns active turn id and aborts', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    const id = agent.send(message('hi'))
    await sleep(10)
    const interruptedId = agent.interrupt('test')
    expect(interruptedId).toBe(id)
  })

  it('clears pending input and aborts active turn', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))

    agent.send(message('first'))
    await sleep(10)
    agent.send(message('second'))
    agent.clear()

    await sleep(150)
    unsubscribe()

    expect(events.some(e => e.type === 'turn.aborted' && e.reason === 'cleared')).toBe(true)
  })

  it('remove aborts active turn and waits for completion', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))

    const turnId = agent.send(message('hi'))
    await sleep(10)
    await agent.remove()

    unsubscribe()
    const turnEvents = events.filter(e => e.turnId === turnId)
    expect(turnEvents.some(e => e.type === 'turn.aborted' && e.reason === 'removed')).toBe(true)
  })

  it('aborts turn when send signal is aborted', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))

    const controller = new AbortController()
    const turnId = agent.send(message('hi'), { signal: controller.signal })
    await sleep(10)
    controller.abort('user abort')

    await sleep(150)
    unsubscribe()

    expect(events.filter(e => e.turnId === turnId).some(e => e.type === 'turn.aborted')).toBe(true)
  })

  it('aborts turn when run stream is cancelled', async () => {
    const { agent } = createTestAgent({ delayMs: 100 })
    const events: AgentEvent[] = []
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))

    const stream = run(agent, message('hi'))
    const reader = stream.getReader()
    await sleep(10)
    await reader.cancel()

    await sleep(150)
    unsubscribe()

    expect(events.some(e => e.type === 'turn.aborted' && e.reason === 'stream cancelled')).toBe(true)
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
      getInput: vi.fn(() => []),
      init: vi.fn(),
      interrupt: vi.fn(),
      remove: vi.fn(),
      send: vi.fn(() => {
        throw error
      }),
      stop: vi.fn(),
      subscribe: vi.fn(() => unsubscribe),
    } as unknown as Agent

    const reader = run(agent, message('hi')).getReader()

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
      getInput: vi.fn(() => []),
      init: vi.fn(),
      interrupt: vi.fn(),
      remove: vi.fn(),
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
      subscribe: vi.fn((_channel: string, next: unknown) => {
        listener = next as (event: AgentEvent) => void
        return unsubscribe
      }),
    } as unknown as Agent

    const reader = run(agent, message('hi')).getReader()
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
      getInput: vi.fn(() => []),
      init: vi.fn(),
      interrupt: vi.fn(),
      remove: vi.fn(),
      send: vi.fn(() => {
        queueMicrotask(() => {
          listener?.({ turnId: 'new-turn', type: 'turn.start' })
          listener?.({ turnId: 'other-turn', type: 'turn.done' })
          listener?.({ turnId: 'new-turn', type: 'turn.done' })
        })
        return 'new-turn'
      }),
      stop: vi.fn(),
      subscribe: vi.fn((_channel: string, next: unknown) => {
        listener = next as (event: AgentEvent) => void
        return unsubscribe
      }),
    } as unknown as Agent

    const reader = run(agent, message('hi')).getReader()
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
