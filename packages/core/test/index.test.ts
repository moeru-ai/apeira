import type { Tool } from '@xsai/shared-chat'

import type { AgentEvent } from '../src/index'
import type { ItemParam } from '../src/types/responses'

import { describe, expect, it } from 'vitest'

import { createAgent } from '../src/index'
import { createPendingInput } from '../src/utils/pending-input'
import { createQueue } from '../src/utils/queue'
import { createThreadStore } from '../src/utils/thread-store'

const wait = async (ms = 0) => {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      clearTimeout(timer)
      resolve()
    }, ms)
  })
}

const message = (content: string): ItemParam => ({
  content,
  role: 'user',
  type: 'message',
})

const assistantMessage = (text: string) => ({
  content: [{ text, type: 'output_text' }],
  phase: 'final_answer',
  role: 'assistant',
  type: 'message',
})

const sse = (event: unknown) =>
  `data: ${JSON.stringify(event)}\n\n`

const createResponseStream = (
  text: string,
  delayMs: number,
  signal?: AbortSignal,
) => {
  const encoder = new TextEncoder()
  const output = assistantMessage(text)

  return new Response(new ReadableStream({
    start: async (controller) => {
      const enqueue = async (event: unknown) => {
        if (signal?.aborted) {
          controller.error(signal.reason)
          return
        }

        controller.enqueue(encoder.encode(sse(event)))

        if (delayMs > 0)
          await wait(delayMs)
      }

      await enqueue({ type: 'response.created' })
      await enqueue({
        item: output,
        output_index: 0,
        type: 'response.output_item.done',
      })
      await enqueue({
        response: {
          output: [output],
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
          },
        },
        type: 'response.completed',
      })

      controller.close()
    },
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
    },
  })
}

const createResponsesFetch = (delayMs = 0) => {
  const bodies: Array<{ input: unknown[], instructions?: unknown, tools?: unknown[] }> = []
  const inputs: unknown[][] = []
  const instructions: unknown[] = []

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const signal = init?.signal instanceof AbortSignal
      ? init.signal
      : undefined

    if (signal?.aborted)
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')

    const body = JSON.parse(String(init?.body)) as { input: unknown[], instructions?: unknown, tools?: unknown[] }
    bodies.push(body)
    inputs.push(body.input)
    instructions.push(body.instructions)

    return createResponseStream(`response ${inputs.length}`, delayMs, signal)
  }

  return {
    bodies,
    fetch,
    inputs,
    instructions,
  }
}

const createTestAgent = (delayMs = 0) => {
  const responsesFetch = createResponsesFetch(delayMs)
  const agent = createAgent({
    instructions: 'You are a behavior test assistant. Answer briefly.',
    name: 'scheduler-test',
    options: {
      apiKey: 'test',
      baseURL: 'https://example.test/v1/',
      fetch: responsesFetch.fetch,
      maxOutputTokens: 128,
      model: 'test-model',
      temperature: 0,
    },
  })

  return {
    agent,
    inputs: responsesFetch.inputs,
    instructions: responsesFetch.instructions,
  }
}

const waitForTurnDone = async (events: AgentEvent[], turnId: string) => {
  for (let i = 0; i < 200; i += 1) {
    const turnEvents = events.filter(event => event.turnId === turnId)
    const failed = turnEvents.find(event => event.type === 'turn.failed')
    const aborted = turnEvents.find(event => event.type === 'turn.aborted')

    if (failed != null)
      throw failed.error

    if (aborted != null)
      throw new Error(`Turn aborted: ${String(aborted.reason)}`)

    if (turnEvents.some(event => event.type === 'turn.done'))
      return

    await wait(5)
  }

  throw new Error(`Timed out waiting for turn.done: ${turnId}`)
}

const readEventStream = async (stream: ReadableStream<AgentEvent>) => {
  const events: AgentEvent[] = []
  const reader = stream.getReader()

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done)
        break

      events.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }

  return events
}

describe('createQueue', () => {
  it('dequeues and drains in FIFO order', () => {
    const queue = createQueue<{ value: number }>()

    expect(queue.enqueue({ value: 1 })).toBe(1)
    expect(queue.enqueue({ value: 2 })).toBe(2)
    expect(queue.size).toBe(2)
    expect(queue.dequeue()).toEqual({ value: 1 })
    expect(Array.from(queue.drain())).toEqual([{ value: 2 }])
    expect(queue.size).toBe(0)
  })
})

describe('createPendingInput', () => {
  it('drains pending input by turn id and drops aborted input', () => {
    const store = createPendingInput()
    const controller = new AbortController()
    controller.abort('stale')

    store.enqueue('first', { input: message('first') })
    store.enqueue('second', { input: message('second') })
    store.enqueue('second', { input: message('aborted'), signal: controller.signal })

    expect(store.drain('second').map(item => item.input)).toEqual([message('second')])
    expect(store.drain('first').map(item => item.input)).toEqual([message('first')])
    expect(store.drain('second')).toEqual([])
  })
})

describe('createThreadStore', () => {
  it('commits by version and isolates stored items from caller mutations', () => {
    const store = createThreadStore([message('initial')])
    const snapshot = store.snapshot()
    const nextItems = [message('next')]

    expect(store.commit(snapshot.version, nextItems)).toBe(true)
    nextItems.push(message('mutated'))

    expect(store.snapshot()).toEqual({
      items: [message('next')],
      version: snapshot.version + 1,
    })
    expect(store.commit(snapshot.version, [message('stale')])).toBe(false)
    expect(store.snapshot().items).toEqual([message('next')])
  })

  it('appends items and invalidates stale snapshots', () => {
    const store = createThreadStore([message('initial')])
    const snapshot = store.snapshot()

    store.append([message('appended')])

    expect(store.snapshot()).toEqual({
      items: [message('initial'), message('appended')],
      version: snapshot.version + 1,
    })
    expect(store.commit(snapshot.version, [message('stale')])).toBe(false)
    expect(store.snapshot().items).toEqual([message('initial'), message('appended')])
  })
})

describe('createAgent', () => {
  it('loads persisted thread state before clear saves reset state', async () => {
    const savedSnapshots: unknown[] = []
    const agent = createAgent({
      instructions: 'You are a plugin test assistant.',
      name: 'clear-storage-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: createResponsesFetch().fetch,
        model: 'test-model',
      },
      plugins: [{
        loadThread: () => ({
          items: [message('persisted history')],
          version: 10,
        }),
        name: 'storage',
        saveThread: ({ snapshot }) => {
          savedSnapshots.push(snapshot)
        },
      }],
    })

    agent.clear()
    await wait()

    expect(savedSnapshots).toEqual([{
      items: [],
      version: 11,
    }])
  })

  it('runs plugin setup sequentially in plugin order', async () => {
    const calls: string[] = []
    const agent = createAgent({
      instructions: 'You are a plugin test assistant.',
      name: 'setup-order-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: createResponsesFetch().fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'first',
        setup: async (api) => {
          await wait()
          api.subscribe('setup', () => calls.push('first heard'))
          calls.push('first setup')
        },
      }, {
        name: 'second',
        setup: (api) => {
          calls.push('second setup')
          api.emit('setup', 'ready')
        },
      }],
    })

    await readEventStream(agent.run(message('use plugin')))

    expect(calls).toEqual([
      'first setup',
      'second setup',
      'first heard',
    ])
  })

  it('runs plugins through thread, turn, response, and storage hooks', async () => {
    const calls: string[] = []
    const responsesFetch = createResponsesFetch()
    const weatherTool: Tool = {
      execute: () => 'sunny',
      function: {
        name: 'weather',
        parameters: {},
      },
      type: 'function',
    }
    const agent = createAgent({
      instructions: 'You are a plugin test assistant.',
      name: 'plugin-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [false, [{
        loadThread: () => {
          calls.push('loadThread')
          return {
            items: [message('loaded history')],
            version: 0,
          }
        },
        name: 'test-plugin',
        onEvent: (event) => {
          if (!(event.type.startsWith('turn.')))
            return

          calls.push(`event:${event.type}`)
        },
        onFinish: () => {
          calls.push('onFinish')
        },
        onStepFinish: () => {
          calls.push('onStepFinish')
        },
        onThreadInit: () => {
          calls.push('onThreadInit')
        },
        onTurnDone: () => {
          calls.push('onTurnDone')
        },
        onTurnStart: () => {
          calls.push('onTurnStart')
        },
        resolveTools: ({ tools }) => {
          calls.push(`resolveTools:${tools.length}`)
          return [weatherTool]
        },
        saveThread: ({ snapshot }) => {
          calls.push(`saveThread:${snapshot.items.length}`)
        },
        setup: () => {
          calls.push('setup')
        },
      }], null],
    })

    const events = await readEventStream(agent.run(message('use plugin')))
    await wait()

    expect(events.at(-1)?.type).toBe('turn.done')
    expect(responsesFetch.inputs[0]).toEqual([
      message('loaded history'),
      message('use plugin'),
    ])
    expect(responsesFetch.bodies[0]?.tools).toEqual([{
      description: null,
      name: 'weather',
      parameters: {},
      strict: true,
      type: 'function',
    }])
    expect(calls).toEqual(expect.arrayContaining([
      'setup',
      'onThreadInit',
      'loadThread',
      'onTurnStart',
      'resolveTools:0',
      'onStepFinish',
      'onFinish',
      'saveThread:3',
      'onTurnDone',
      'event:turn.queued',
      'event:turn.start',
      'event:turn.done',
    ]))
  })

  it('merges agent, thread, and run context for instructions', async () => {
    interface Context {
      locale: string
      product: string
      requestId?: string
      userId?: string
    }

    const responsesFetch = createResponsesFetch()
    const agent = createAgent<Context>({
      context: {
        locale: 'en-US',
        product: 'docs',
      },
      instructions: context => JSON.stringify(context),
      name: 'context-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
    })
    const thread = agent.thread({
      context: {
        locale: 'zh-CN',
        userId: 'u_123',
      },
    })

    await readEventStream(thread.run(message('Use merged context.'), {
      context: {
        requestId: 'req_123',
      },
    }))

    expect(JSON.parse(String(responsesFetch.instructions[0]))).toEqual({
      locale: 'zh-CN',
      product: 'docs',
      requestId: 'req_123',
      userId: 'u_123',
    })
  })

  it('keeps agent and thread setContext persistent and run context transient', async () => {
    interface Context {
      locale: string
      product: string
      requestId?: string
    }

    const responsesFetch = createResponsesFetch()
    const agent = createAgent<Context>({
      context: {
        locale: 'en-US',
        product: 'docs',
      },
      instructions: context => JSON.stringify(context),
      name: 'context-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
    })
    const thread = agent.thread()

    agent.setContext({ product: 'help' })
    thread.setContext({ locale: 'ja-JP' })

    await readEventStream(thread.run(message('Run with request context.'), {
      context: { requestId: 'req_123' },
    }))
    await readEventStream(thread.run(message('Run without request context.')))

    expect(JSON.parse(String(responsesFetch.instructions[0]))).toMatchObject({
      locale: 'ja-JP',
      requestId: 'req_123',
    })
    expect(JSON.parse(String(responsesFetch.instructions[1]))).toMatchObject({
      locale: 'ja-JP',
      product: 'help',
    })
    expect(JSON.parse(String(responsesFetch.instructions[1]))).not.toHaveProperty('requestId')
    expect(agent.getContext()).toEqual({
      locale: 'en-US',
      product: 'help',
    })
  })

  it('merges context into an existing thread by id without replacing history', async () => {
    interface Context {
      locale: string
      product: string
      userId?: string
    }

    const responsesFetch = createResponsesFetch()
    const agent = createAgent<Context>({
      context: {
        locale: 'en-US',
        product: 'docs',
      },
      instructions: context => JSON.stringify(context),
      name: 'context-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
    })

    const thread = agent.thread({
      context: { userId: 'u_123' },
      id: 'existing-thread',
    })
    const sameThread = agent.thread({
      context: { locale: 'zh-CN' },
      id: 'existing-thread',
    })

    expect(sameThread).toBe(thread)

    await readEventStream(thread.run(message('Use updated thread context.')))

    expect(JSON.parse(String(responsesFetch.instructions[0]))).toMatchObject({
      locale: 'zh-CN',
      product: 'docs',
      userId: 'u_123',
    })
  })

  it('throws when initial input is provided for an existing thread', () => {
    const { agent } = createTestAgent()

    agent.thread({ id: 'existing-thread' })

    expect(() => agent.thread({
      id: 'existing-thread',
      input: [message('initial input')],
    })).toThrow('Thread already exists: existing-thread')
  })

  it('runs different threads with isolated queues and contexts', async () => {
    interface Context {
      locale: string
      product: string
      userId?: string
    }

    const events: AgentEvent[] = []
    const responsesFetch = createResponsesFetch(2)
    const agent = createAgent<Context>({
      context: {
        locale: 'en-US',
        product: 'docs',
      },
      instructions: context => JSON.stringify(context),
      name: 'multi-thread-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
    })
    const unsubscribe = agent.subscribe(event => events.push(event))
    const first = agent.thread({
      context: { userId: 'first' },
      id: 'first-thread',
    })
    const second = agent.thread({
      context: { userId: 'second' },
      id: 'second-thread',
    })

    try {
      await Promise.all([
        readEventStream(first.run(message('First thread.'))),
        readEventStream(second.run(message('Second thread.'))),
      ])
    }
    finally {
      unsubscribe()
    }

    expect(new Set(events.map(event => event.threadId))).toEqual(new Set([
      'first-thread',
      'second-thread',
    ]))
    const userIds = responsesFetch.instructions.map((value) => {
      const context = JSON.parse(String(value)) as Context
      return context.userId
    }).sort((left, right) => String(left).localeCompare(String(right)))

    expect(userIds).toEqual([
      'first',
      'second',
    ])
  })

  it('runs a turn and returns a stream for run', async () => {
    const { agent } = createTestAgent()

    const events = await readEventStream(agent.run(message('Say stream.')))
    const eventTypes = events.map(event => event.type)
    const turnIds = new Set(events.map(event => event.turnId))
    const stepDone = events.find(event => event.type === 'step.done')

    expect(turnIds.size).toBe(1)
    expect([...turnIds][0]).toEqual(expect.any(String))
    expect(eventTypes).toEqual([
      'turn.queued',
      'turn.start',
      'step.start',
      'step.done',
      'turn.done',
    ])
    expect(stepDone?.output?.length).toBeGreaterThan(0)
  })

  it('queues submitted top-level turns and runs them one at a time', async () => {
    const events: AgentEvent[] = []
    const { agent } = createTestAgent(2)
    const unsubscribe = agent.subscribe(event => events.push(event))

    const first = readEventStream(agent.run(message('First turn.')))
    const second = readEventStream(agent.run(message('Second turn.')))

    try {
      await Promise.all([first, second])
    }
    finally {
      unsubscribe()
    }

    const turnIds = [...new Set(events.map(event => event.turnId))]
    const [firstTurnId, secondTurnId] = turnIds
    const firstStartIndex = events.findIndex(event =>
      event.turnId === firstTurnId && event.type === 'turn.start')
    const firstDoneIndex = events.findIndex(event =>
      event.turnId === firstTurnId && event.type === 'turn.done')
    const secondStartIndex = events.findIndex(event =>
      event.turnId === secondTurnId && event.type === 'turn.start')
    const secondDoneIndex = events.findIndex(event =>
      event.turnId === secondTurnId && event.type === 'turn.done')

    expect(firstStartIndex).toBeGreaterThanOrEqual(0)
    expect(firstDoneIndex).toBeGreaterThan(firstStartIndex)
    expect(secondStartIndex).toBeGreaterThan(firstDoneIndex)
    expect(secondDoneIndex).toBeGreaterThan(secondStartIndex)
  })

  it('injects send input into the active regular task', async () => {
    const events: AgentEvent[] = []
    const { agent, inputs } = createTestAgent(2)
    let turnId: string
    let injectedTurnId: string | undefined

    const unsubscribe = agent.subscribe((event) => {
      events.push(event)

      if (
        event.turnId === turnId
        && event.type === 'step.start'
        && injectedTurnId == null
      ) {
        injectedTurnId = agent.send(message('Follow up.'))
      }
    })

    turnId = agent.send(message('Initial turn.'))

    try {
      await waitForTurnDone(events, turnId)
    }
    finally {
      unsubscribe()
    }

    const eventTypes = events
      .filter(event => event.turnId === turnId)
      .map(event => event.type)

    expect(injectedTurnId).toBe(turnId)
    expect(eventTypes.filter(type => type === 'turn.start')).toHaveLength(1)
    expect(eventTypes.filter(type => type === 'step.start')).toHaveLength(2)
    expect(eventTypes).toContain('turn.input_queued')
    expect(eventTypes).toContain('turn.input_drained')
    expect(inputs).toHaveLength(2)
    expect(inputs[0]?.at(-1)).toMatchObject({ content: 'Initial turn.' })
    expect(inputs[1]?.at(-1)).toMatchObject({ content: 'Follow up.' })
  })

  it('creates a new turn when send is called from a terminal event', async () => {
    const events: AgentEvent[] = []
    const { agent } = createTestAgent()
    let firstTurnId: string
    let secondTurnId: string | undefined

    const unsubscribe = agent.subscribe((event) => {
      events.push(event)

      if (
        event.turnId === firstTurnId
        && event.type === 'turn.done'
        && secondTurnId == null
      ) {
        secondTurnId = agent.send(message('After terminal event.'))
      }
    })

    firstTurnId = agent.send(message('Initial turn.'))

    try {
      await waitForTurnDone(events, firstTurnId)
      expect(secondTurnId).toEqual(expect.any(String))
      expect(secondTurnId).not.toBe(firstTurnId)
      await waitForTurnDone(events, secondTurnId!)
    }
    finally {
      unsubscribe()
    }

    expect(events.some(event =>
      event.turnId === firstTurnId && event.type === 'turn.input_queued')).toBe(false)
    expect(events.some(event =>
      event.turnId === secondTurnId && event.type === 'turn.queued')).toBe(true)
  })

  it('injects send input into the next queued turn from a terminal event', async () => {
    const events: AgentEvent[] = []
    const { agent, inputs } = createTestAgent(2)
    let firstTurnId: string | undefined
    let secondTurnId: string | undefined
    let injectedTurnId: string | undefined

    const unsubscribe = agent.subscribe((event) => {
      events.push(event)

      if (event.type === 'turn.queued') {
        firstTurnId ??= event.turnId

        if (event.turnId !== firstTurnId)
          secondTurnId ??= event.turnId
      }

      if (
        event.turnId === firstTurnId
        && event.type === 'turn.done'
        && injectedTurnId == null
      ) {
        injectedTurnId = agent.send(message('Queued follow up.'))
      }
    })

    const first = readEventStream(agent.run(message('First turn.')))
    const second = readEventStream(agent.run(message('Second queued turn.')))

    try {
      await Promise.all([first, second])
    }
    finally {
      unsubscribe()
    }

    expect(firstTurnId).toEqual(expect.any(String))
    expect(secondTurnId).toEqual(expect.any(String))
    expect(injectedTurnId).toBe(secondTurnId)
    expect(events.some(event =>
      event.turnId === secondTurnId && event.type === 'turn.input_queued')).toBe(true)
    expect(inputs).toHaveLength(3)
    expect(inputs[1]?.at(-1)).toMatchObject({ content: 'Second queued turn.' })
    expect(inputs[2]?.at(-1)).toMatchObject({ content: 'Queued follow up.' })
  })

  it('aborts the running turn without clearing queued top-level turns', async () => {
    const { agent } = createTestAgent(2)
    let aborted = false
    const unsubscribe = agent.subscribe((event) => {
      if (event.type !== 'turn.start' || aborted)
        return

      aborted = true
      queueMicrotask(() => agent.abort('test abort'))
    })

    const first = readEventStream(agent.run(message('Abort this turn.')))
    const second = readEventStream(agent.run(message('This queued turn should still run.')))
    const [firstEvents, secondEvents] = await Promise.all([first, second])
    unsubscribe()

    expect(firstEvents.map(event => event.type)).toContain('turn.aborted')
    expect(firstEvents.map(event => event.type)).not.toContain('turn.done')
    expect(secondEvents.map(event => event.type)).toContain('turn.start')
    expect(secondEvents.map(event => event.type)).toContain('turn.done')
  })

  it('queues send input to the next turn when the active turn is aborted', async () => {
    const events: AgentEvent[] = []
    const { agent, inputs } = createTestAgent(2)
    let injectedTurnId: string | undefined
    let aborted = false
    const unsubscribe = agent.subscribe((event) => {
      events.push(event)

      if (event.type !== 'turn.start' || aborted)
        return

      aborted = true
      queueMicrotask(() => {
        agent.abort('test abort')
        injectedTurnId = agent.send(message('After abort.'))
      })
    })

    const first = readEventStream(agent.run(message('Abort this turn.')))
    const second = readEventStream(agent.run(message('This queued turn should receive input.')))
    const [firstEvents, secondEvents] = await Promise.all([first, second])
    unsubscribe()

    const firstTurnId = firstEvents[0]?.turnId
    const secondTurnId = secondEvents[0]?.turnId

    expect(injectedTurnId).toBe(secondTurnId)
    expect(events.some(event =>
      event.turnId === firstTurnId && event.type === 'turn.input_queued')).toBe(false)
    expect(events.some(event =>
      event.turnId === secondTurnId && event.type === 'turn.input_drained')).toBe(true)
    expect(inputs.at(-1)?.at(-1)).toMatchObject({ content: 'After abort.' })
  })

  it('does not send input to an already aborted queued turn', async () => {
    const events: AgentEvent[] = []
    const { agent, inputs } = createTestAgent(2)
    const controller = new AbortController()
    let firstTurnId: string | undefined
    let sentTurnId: string | undefined
    controller.abort('stale queued turn')

    const unsubscribe = agent.subscribe((event) => {
      events.push(event)
      firstTurnId ??= event.turnId

      if (
        event.turnId === firstTurnId
        && event.type === 'turn.done'
        && sentTurnId == null
      ) {
        sentTurnId = agent.send(message('After stale queued turn.'))
      }
    })

    const first = readEventStream(agent.run(message('First turn.')))
    const second = readEventStream(agent.run(message('Already aborted queued turn.'), {
      signal: controller.signal,
    }))

    try {
      const [, secondEvents] = await Promise.all([first, second])
      expect(sentTurnId).toEqual(expect.any(String))
      await waitForTurnDone(events, sentTurnId!)

      const secondEventTypes = secondEvents.map(event => event.type)
      expect(secondEventTypes).toEqual(['turn.queued', 'turn.aborted'])
      expect(sentTurnId).not.toBe(secondEvents[0]?.turnId)
    }
    finally {
      unsubscribe()
    }

    expect(inputs).toHaveLength(2)
    expect(inputs.at(-1)?.at(-1)).toMatchObject({ content: 'After stale queued turn.' })
    expect(inputs.flat().some(item =>
      typeof item === 'object'
      && item != null
      && 'content' in item
      && item.content === 'Already aborted queued turn.')).toBe(false)
  })

  it('interrupts the active turn and sends input to the next turn', async () => {
    const events: AgentEvent[] = []
    const { agent, inputs } = createTestAgent(2)
    let interruptedTurnId: string | undefined
    let interrupted = false
    const unsubscribe = agent.subscribe((event) => {
      events.push(event)

      if (event.type !== 'turn.start' || interrupted)
        return

      interrupted = true
      queueMicrotask(() =>
        interruptedTurnId = agent.interrupt(message('Interrupting input.'), 'test interrupt'),
      )
    })

    const first = readEventStream(agent.run(message('Interrupted turn.')))
    const second = readEventStream(agent.run(message('Queued turn.')))
    const [firstEvents, secondEvents] = await Promise.all([first, second])
    unsubscribe()

    const firstTurnId = firstEvents[0]?.turnId
    const secondTurnId = secondEvents[0]?.turnId

    expect(interruptedTurnId).toBe(secondTurnId)
    expect(firstEvents.map(event => event.type)).toContain('turn.aborted')
    const abortedEvent = events.find(event =>
      event.turnId === firstTurnId && event.type === 'turn.aborted')
    expect(abortedEvent?.type === 'turn.aborted' && abortedEvent.reason).toBe('test interrupt')
    expect(events.some(event =>
      event.turnId === secondTurnId && event.type === 'turn.input_drained')).toBe(true)
    expect(inputs.at(-1)?.at(0)).toMatchObject({
      content: '<turn_aborted>\nThe previous turn was interrupted on purpose. Any tool calls that were running may have partially executed.\n</turn_aborted>',
    })
    expect(inputs.at(-1)?.at(-1)).toMatchObject({ content: 'Interrupting input.' })
  })

  it('drops interrupted input when its signal is already aborted', async () => {
    const events: AgentEvent[] = []
    const { agent, inputs } = createTestAgent(2)
    const controller = new AbortController()
    let interrupted = false
    const unsubscribe = agent.subscribe((event) => {
      events.push(event)

      if (event.type !== 'turn.start' || interrupted)
        return

      interrupted = true
      queueMicrotask(() => {
        controller.abort('stale interrupt')
        agent.interrupt(message('Stale interrupting input.'), 'test interrupt', {
          signal: controller.signal,
        })
      })
    })

    const first = readEventStream(agent.run(message('Interrupted turn.')))
    const second = readEventStream(agent.run(message('Queued turn.')))
    await Promise.all([first, second])
    unsubscribe()

    expect(events.map(event => event.type)).toContain('turn.aborted')
    expect(inputs.at(-1)?.at(-1)).toMatchObject({ content: 'Queued turn.' })
    expect(inputs.flat().some(item =>
      typeof item === 'object'
      && item != null
      && 'content' in item
      && item.content === 'Stale interrupting input.')).toBe(false)
  })

  it('clears the running turn, queued turns, and pending input', async () => {
    const { agent } = createTestAgent(2)
    let cleared = false
    const unsubscribe = agent.subscribe((event) => {
      if (event.type !== 'turn.start' || cleared)
        return

      cleared = true
      queueMicrotask(() => agent.clear())
    })

    const first = readEventStream(agent.run(message('Start a response that will be cleared.')))
    const second = readEventStream(agent.run(message('This queued response should be cleared.')))
    const [firstEvents, secondEvents] = await Promise.all([first, second])
    unsubscribe()

    const firstEventTypes = firstEvents.map(event => event.type)
    const secondEventTypes = secondEvents.map(event => event.type)
    const firstAborted = firstEvents.find(event => event.type === 'turn.aborted')
    const secondAborted = secondEvents.find(event => event.type === 'turn.aborted')

    expect(firstEventTypes).toContain('turn.start')
    expect(firstEventTypes).toContain('turn.aborted')
    expect(firstEventTypes).not.toContain('turn.done')
    expect(firstAborted?.reason).toBe('cleared')
    expect(secondEventTypes).toEqual(['turn.queued', 'turn.aborted'])
    expect(secondAborted?.reason).toBe('cleared')
  })
})
