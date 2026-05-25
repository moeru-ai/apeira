import type { Tool } from '@xsai/shared-chat'

import type { AgentEvent } from '../src/index'
import type { ItemParam } from '../src/types/responses'

import Queue from 'yocto-queue'

import { describe, expect, it } from 'vitest'

import { createAgent, createEpisodic } from '../src/index'
import { createPendingInput } from '../src/utils/pending-input'
import { createSessionStore } from '../src/utils/session-store'

const createMemoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial))

  return {
    getItem: (key: string) => values.get(key),
    removeItem: (key: string) => {
      values.delete(key)
    },
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    values,
  }
}

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

const episodicFromItems = (items: ItemParam[]) => {
  const episodic = createEpisodic()
  episodic.appendItems(items, { source: 'user' })
  return episodic.toJSONL()
}

const itemsFromEpisodic = (jsonl: string): ItemParam[] =>
  jsonl
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { kind: string, payload?: { item?: ItemParam } })
    .filter(episode => episode.kind === 'item')
    .map(episode => episode.payload!.item!)

const usageFromEpisodic = (jsonl: string) =>
  jsonl
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as { kind: string, payload?: { data?: unknown, event?: string } })
    .find(episode => episode.kind === 'meta' && episode.payload?.event === 'turn.usage')
    ?.payload
    ?.data

const parseSessionState = (value: string | undefined): { context: unknown, episodic: string, version: number } =>
  JSON.parse(String(value)) as { context: unknown, episodic: string, version: number }

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
    const queue = new Queue<{ value: number }>()

    expect(queue.enqueue({ value: 1 })).toBe(undefined)
    expect(queue.enqueue({ value: 2 })).toBe(undefined)
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

describe('createEpisodic', () => {
  it('appends episodes with increasing ids and roundtrips JSONL', () => {
    const episodic = createEpisodic()

    episodic.appendItems([message('first')], { source: 'user', turnId: 'turn-1' })
    episodic.append({
      kind: 'boundary',
      meta: { source: 'agent', turnId: 'turn-1' },
      payload: { content: 'checkpoint content', reason: 'checkpoint', title: 'checkpoint' },
    })

    const restored = createEpisodic(episodic.toJSONL())

    expect(restored.read({ fromId: 0 }).map(episode => episode.id)).toEqual([1, 2])
    expect(restored.read({ afterBoundary: 'checkpoint' })).toEqual([])
    expect(restored.read({ kind: 'item', turnId: 'turn-1' })).toHaveLength(1)
  })

  it('skips bad JSONL lines and records parse errors', () => {
    const episodic = createEpisodic(`not json\n{}\n${episodicFromItems([message('valid')])}`)
    const meta = episodic.read({ fromId: 0, kind: 'meta' })[0]
    const data = meta?.payload.data as undefined | { count?: unknown, errors?: unknown }

    expect(meta?.payload.event).toBe('error.parse')
    expect(data?.count).toBe(2)
    expect(Array.isArray(data?.errors)).toBe(true)
    expect(itemsFromEpisodic(episodic.toJSONL())).toEqual([message('valid')])
  })

  it('limits unconstrained reads to the latest 100 episodes', () => {
    const episodic = createEpisodic()

    for (let i = 0; i < 101; i += 1)
      episodic.appendItems([message(String(i))], { source: 'user' })

    const read = episodic.read()

    expect(read).toHaveLength(100)
    expect(read[0]?.id).toBe(2)
  })

  it('does not apply the default limit to afterBoundary queries', () => {
    const episodic = createEpisodic()
    episodic.append({
      kind: 'boundary',
      meta: { source: 'agent' },
      payload: { content: 'checkpoint', reason: 'checkpoint', title: 'checkpoint' },
    })

    for (let i = 0; i < 101; i += 1)
      episodic.appendItems([message(String(i))], { source: 'user' })

    const read = episodic.read({ afterBoundary: 'checkpoint' })

    expect(read).toHaveLength(101)
    expect(read[0]?.id).toBe(2)
  })

  it('applies explicit limit after query filters', () => {
    const episodic = createEpisodic()
    episodic.append({
      kind: 'boundary',
      meta: { source: 'agent' },
      payload: { content: 'checkpoint', reason: 'checkpoint', title: 'checkpoint' },
    })

    for (let i = 0; i < 5; i += 1)
      episodic.appendItems([message(`item-${i}`)], { source: 'user' })

    expect(episodic.read({ afterBoundary: 'checkpoint', limit: 2 }).map(episode => episode.id)).toEqual([5, 6])
    expect(episodic.read({ kind: 'item', limit: 3 }).map(episode => episode.id)).toEqual([4, 5, 6])
    expect(episodic.read({ limit: 0 })).toEqual([])
    expect(episodic.read({ limit: -1 })).toEqual([])
  })
})

describe('assemble', () => {
  it('starts from the last checkpoint and injects visible boundaries', () => {
    const episodic = createEpisodic()
    episodic.appendItems([message('before')], { source: 'user' })
    episodic.append({
      kind: 'boundary',
      meta: { source: 'agent' },
      payload: { content: 'checkpoint content', reason: 'checkpoint', title: 'checkpoint' },
    })
    episodic.appendItems([message('after')], { source: 'user' })
    const store = createSessionStore([], {}, episodic.toJSONL())

    expect(store.assemble({ start: { reason: 'checkpoint', type: 'last-boundary' } }).items).toEqual([
      expect.objectContaining({ content: '<checkpoint>\ncheckpoint content\n</checkpoint>' }),
      message('after'),
    ])
  })

  it('keeps function call outputs paired and truncates oversized tool output', () => {
    const longOutput = `${'x'.repeat(4_001)}middle${('y').repeat(4_001)}`
    const call = { arguments: '{}', call_id: 'call-1', name: 'tool', type: 'function_call' } as ItemParam
    const orphan = { call_id: 'missing', output: 'orphan', type: 'function_call_output' } as ItemParam
    const output = { call_id: 'call-1', output: longOutput, type: 'function_call_output' } as ItemParam
    const store = createSessionStore([orphan, call, output])
    const items = store.assemble().items

    expect(items[0]).toEqual(call)
    expect(items).toHaveLength(2)
    expect(items[1]).toMatchObject({ call_id: 'call-1', type: 'function_call_output' })
    expect(JSON.stringify(items[1])).toContain('(truncated: 8 chars omitted)')
    expect(JSON.stringify(items[1])).toContain('xxxx')
    expect(JSON.stringify(items[1])).toContain('yyyy')
    expect(JSON.stringify(items[1])).not.toContain('orphan')
  })

  it('keeps current turn input when usage is over budget without a checkpoint', () => {
    const episodic = createEpisodic()
    episodic.appendItems([message('drop old')], { source: 'user', turnId: 'old-turn' })
    episodic.append({
      kind: 'meta',
      meta: { source: 'runtime' },
      payload: {
        data: { inputTokens: 100, outputTokens: 1, totalTokens: 101 },
        event: 'turn.usage',
      },
    })
    episodic.appendItems([message('keep current')], { source: 'user', turnId: 'current-turn' })
    const store = createSessionStore([], {}, episodic.toJSONL())
    const assembled = store.assemble({ maxTokens: 1, turnId: 'current-turn' })

    expect(assembled.items).toEqual([message('keep current')])
    expect(assembled.meta.truncated).toBe(true)
  })

  it('supports custom normalize functions', () => {
    const store = createSessionStore([message('original')])

    expect(store.assemble({ normalize: () => [message('custom')] }).items).toEqual([message('custom')])
  })
})

describe('createSessionStore', () => {
  it('assembles initial items and snapshots episodic JSONL', () => {
    const store = createSessionStore([message('initial')])
    const snapshot = store.snapshot()

    expect(store.assemble().items).toEqual([message('initial')])
    expect(itemsFromEpisodic(snapshot.episodic)).toEqual([message('initial')])
    expect(snapshot.context).toEqual({})
    expect(typeof snapshot.episodic).toBe('string')
    expect(snapshot.version).toBe(0)
  })

  it('appends items through episodic and merges forks atomically', () => {
    const store = createSessionStore([message('initial')])
    const snapshot = store.snapshot()
    const fork = store.fork()

    fork.episodic.appendItems([message('appended')], { source: 'user' })
    const forkEpisodeId = fork.episodic.read({ kind: 'item', limit: 1 })[0]?.id
    store.merge(fork)

    expect(itemsFromEpisodic(store.snapshot().episodic)).toEqual([message('initial'), message('appended')])
    expect(store.episodic.read({ kind: 'item', limit: 1 })[0]?.id).toBe(forkEpisodeId)
    expect(store.snapshot().version).toBe(snapshot.version + 1)
  })

  it('stores session context alongside items', () => {
    const store = createSessionStore<{ locale?: string }>([message('initial')], { locale: 'en-US' })

    store.setContext({ locale: 'ja-JP' })

    expect(store.getContext()).toEqual({ locale: 'ja-JP' })
    const snapshot = store.snapshot()
    expect(snapshot.context).toEqual({ locale: 'ja-JP' })
    expect(typeof snapshot.episodic).toBe('string')
    expect(snapshot.version).toBe(0)
    expect(itemsFromEpisodic(store.snapshot().episodic)).toEqual([message('initial')])
  })
})

describe('createAgent', () => {
  it('loads persisted session state before clear saves reset state', async () => {
    const storage = createMemoryStorage({
      '["clear-storage-test","default"]': JSON.stringify({
        context: { locale: 'en-US' },
        episodic: episodicFromItems([message('persisted history')]),
        version: 10,
      }),
    })
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
        name: 'storage',
        storage,
      }],
    })

    agent.clear()
    await wait()

    expect(JSON.parse(String(storage.values.get('["clear-storage-test","default"]')))).toEqual({
      context: {},
      episodic: '',
      version: 11,
    })
  })

  it('retries loading session state after storage getItem fails', async () => {
    const responsesFetch = createResponsesFetch()
    const events: AgentEvent[] = []
    let loadAttempts = 0
    const agent = createAgent({
      instructions: 'You are a plugin test assistant.',
      name: 'load-retry-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage: {
          getItem: () => {
            loadAttempts += 1

            if (loadAttempts === 1)
              throw new Error('temporary storage failure')
          },
          removeItem: () => {},
          setItem: () => {},
        },
      }],
    })

    const unsubscribe = agent.subscribe('apeira', event => events.push(event))
    const failedTurnId = agent.send(message('first'))

    try {
      for (let i = 0; i < 200; i += 1) {
        if (events.some(event => event.turnId === failedTurnId && event.type === 'turn.failed'))
          break

        await wait(5)
      }

      const streamEvents = await readEventStream(agent.run(message('second')))

      expect(streamEvents.at(-1)?.type).toBe('turn.done')
      expect(loadAttempts).toBe(2)
    }
    finally {
      unsubscribe()
    }
  })

  it('serializes response save and clear save', async () => {
    const saves: string[] = []
    const agent = createAgent({
      instructions: 'You are a plugin test assistant.',
      name: 'save-race-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: createResponsesFetch().fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage: {
          getItem: () => undefined,
          removeItem: () => {},
          setItem: async (_key, value) => {
            const state = JSON.parse(value) as { episodic: string }
            const phase = itemsFromEpisodic(state.episodic).length > 0 ? 'response' : 'clear'
            saves.push(`${phase}:start`)

            if (phase === 'response') {
              agent.clear()
              await wait(10)
            }

            saves.push(`${phase}:end`)
          },
        },
      }],
    })

    const events = await readEventStream(agent.run(message('race')))
    await wait()

    expect(events.at(-1)?.type).toBe('turn.aborted')
    expect(saves).toEqual([
      'response:start',
      'response:end',
      'clear:start',
      'clear:end',
    ])
  })

  it('aborts a dequeued turn while loading session state', async () => {
    const events: AgentEvent[] = []
    let resolveLoad: (() => void) | undefined
    let loadStarted = false
    const agent = createAgent({
      instructions: 'You are a plugin test assistant.',
      name: 'clear-during-load-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: createResponsesFetch().fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage: {
          getItem: async () => {
            loadStarted = true
            await new Promise<void>((resolve) => {
              resolveLoad = resolve
            })
            return undefined
          },
          removeItem: () => {},
          setItem: () => {},
        },
      }],
    })
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))
    const turnId = agent.send(message('slow load'))

    try {
      for (let i = 0; i < 200; i += 1) {
        if (loadStarted)
          break

        await wait(5)
      }

      expect(loadStarted).toBe(true)

      agent.clear()
      resolveLoad?.()

      for (let i = 0; i < 200; i += 1) {
        if (events.some(event => event.turnId === turnId && event.type === 'turn.aborted'))
          break

        await wait(5)
      }

      expect(events.some(event => event.turnId === turnId && event.type === 'turn.aborted')).toBe(true)
    }
    finally {
      unsubscribe()
    }
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

  it('exposes plugin channels through top-level emit and subscribe', async () => {
    const received: unknown[] = []
    const agent = createAgent({
      instructions: 'You are a plugin test assistant.',
      name: 'channel-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: createResponsesFetch().fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'channel-plugin',
        setup: (api) => {
          api.subscribe('mirror', event => received.push({ event, source: 'plugin' }))
        },
      }],
    })

    const unsubscribe = agent.subscribe('mirror', event => received.push({ event, source: 'agent' }))

    agent.emit('mirror', { ok: true })
    await wait()
    unsubscribe()

    expect(received).toEqual([
      { event: { ok: true }, source: 'plugin' },
      { event: { ok: true }, source: 'agent' },
    ])
  })

  it('runs plugins through session, turn, response, and storage hooks', async () => {
    const calls: string[] = []
    const storage = createMemoryStorage({
      '["plugin-test","default"]': JSON.stringify({
        context: {},
        episodic: episodicFromItems([message('loaded history')]),
        version: 0,
      }),
    })
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
        name: 'test-plugin',
        onEvent: (event) => {
          if (!(event.type.startsWith('turn.')))
            return

          calls.push(`event:${event.type}`)
        },
        onFinish: () => {
          calls.push('onFinish')
        },
        onSessionInit: () => {
          calls.push('onSessionInit')
        },
        onStepFinish: () => {
          calls.push('onStepFinish')
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
        setup: () => {
          calls.push('setup')
        },
        storage: {
          getItem: (key) => {
            calls.push('loadSession')
            return storage.getItem(key)
          },
          removeItem: key => storage.removeItem(key),
          setItem: (key, value) => {
            const state = JSON.parse(value) as { episodic: string }
            calls.push(`saveSession:${itemsFromEpisodic(state.episodic).length}`)
            storage.setItem(key, value)
          },
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
      'onSessionInit',
      'loadSession',
      'onTurnStart',
      'resolveTools:0',
      'onStepFinish',
      'onFinish',
      'saveSession:3',
      'onTurnDone',
      'event:turn.queued',
      'event:turn.start',
      'event:turn.done',
    ]))
  })

  it('uses the current response context for drained input hooks', async () => {
    const records: Array<{ hook: string, lastInput?: unknown, requestId?: string }> = []
    const storage = createMemoryStorage()
    const responsesFetch = createResponsesFetch(2)
    const agent = createAgent<{ requestId?: string }>({
      context: {},
      instructions: 'You are a plugin test assistant.',
      name: 'response-context-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'context-recorder',
        onTurnDone: ({ context, input }) => {
          records.push({ hook: 'onTurnDone', lastInput: input.at(-1), requestId: context.requestId })
        },
        storage: {
          getItem: key => storage.getItem(key),
          removeItem: key => storage.removeItem(key),
          setItem: (key, value) => {
            const state = JSON.parse(value) as { context: { requestId?: string }, episodic: string }
            const items = itemsFromEpisodic(state.episodic)
            records.push({
              hook: 'saveSession',
              lastInput: items.at(-1),
              requestId: state.context.requestId,
            })
            storage.setItem(key, value)
          },
        },
      }],
    })
    const events: AgentEvent[] = []
    let turnId: string
    let injectedTurnId: string | undefined

    const unsubscribe = agent.subscribe('apeira', (event) => {
      events.push(event)

      if (
        event.turnId === turnId
        && event.type === 'step.start'
        && injectedTurnId == null
      ) {
        injectedTurnId = agent.send(message('Follow up.'), {
          context: { requestId: 'follow' },
        })
      }
    })

    turnId = agent.send(message('Initial turn.'), {
      context: { requestId: 'initial' },
    })

    try {
      await waitForTurnDone(events, turnId)
    }
    finally {
      unsubscribe()
    }

    expect(injectedTurnId).toBe(turnId)
    expect(records.at(-1)).toEqual({
      hook: 'onTurnDone',
      lastInput: message('Follow up.'),
      requestId: 'follow',
    })
    expect(records).toContainEqual({
      hook: 'saveSession',
      lastInput: assistantMessage('response 2'),
      requestId: undefined,
    })
  })

  it('merges agent, session, and run context for instructions', async () => {
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
    const session = agent.session({
      context: {
        locale: 'zh-CN',
        userId: 'u_123',
      },
    })

    await readEventStream(session.run(message('Use merged context.'), {
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

  it('keeps agent and session setContext persistent and run context transient', async () => {
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
    const session = agent.session()

    agent.setContext({ product: 'help' })
    session.setContext({ locale: 'ja-JP' })

    await readEventStream(session.run(message('Run with request context.'), {
      context: { requestId: 'req_123' },
    }))
    await readEventStream(session.run(message('Run without request context.')))

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

  it('persists session context and treats session({ context }) as a default', async () => {
    interface Context {
      locale?: string
      product?: string
    }

    const storage = createMemoryStorage()
    const responsesFetch = createResponsesFetch()
    const agent = createAgent<Context>({
      context: {},
      instructions: context => JSON.stringify(context),
      name: 'session-storage-context-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage,
      }],
    })

    const session = agent.session({
      context: { locale: 'en-US' },
      id: 'persisted-session',
    })

    session.setContext({ locale: 'ja-JP' })
    await wait()

    expect(JSON.parse(String(storage.values.get('["session-storage-context-test","persisted-session"]')))).toMatchObject({
      context: { locale: 'ja-JP' },
    })

    const restoredAgent = createAgent<Context>({
      context: {},
      instructions: context => JSON.stringify(context),
      name: 'session-storage-context-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage,
      }],
    })
    const restored = restoredAgent.session({
      context: { locale: 'fr-FR', product: 'docs' },
      id: 'persisted-session',
    })

    await readEventStream(restored.run(message('Use persisted context.')))

    expect(JSON.parse(String(responsesFetch.instructions[0]))).toEqual({
      locale: 'ja-JP',
      product: 'docs',
    })
  })

  it('does not let session context updates invalidate an in-flight response commit', async () => {
    const storage = createMemoryStorage()
    const responsesFetch = createResponsesFetch(2)
    const agent = createAgent<{ locale?: string }>({
      context: {},
      instructions: 'You are a plugin test assistant.',
      name: 'context-race-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage,
      }],
    })

    const session = agent.session({ id: 'race-session' })
    const events: AgentEvent[] = []
    let updated = false

    const unsubscribe = session.subscribe('apeira', (event) => {
      events.push(event)

      if (event.type === 'step.start' && !updated) {
        updated = true
        session.setContext({ locale: 'ja-JP' })
      }
    })

    try {
      await readEventStream(session.run(message('Keep both context and response.')))
      await wait()
    }
    finally {
      unsubscribe()
    }

    expect(events.at(-1)?.type).toBe('turn.done')
    const contextRaceState = parseSessionState(storage.values.get('["context-race-test","race-session"]'))
    expect(contextRaceState.context).toEqual({ locale: 'ja-JP' })
    expect(typeof contextRaceState.episodic).toBe('string')
    expect(contextRaceState.version).toBe(1)
    expect(itemsFromEpisodic(contextRaceState.episodic)).toEqual([
      message('Keep both context and response.'),
      assistantMessage('response 1'),
    ])
    expect(usageFromEpisodic(contextRaceState.episodic)).toEqual({
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
    })
  })

  it('merges context into an existing session by id without replacing history', async () => {
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

    const session = agent.session({
      context: { userId: 'u_123' },
      id: 'existing-session',
    })
    const sameSession = agent.session({
      context: { locale: 'zh-CN' },
      id: 'existing-session',
    })

    expect(sameSession).toBe(session)

    await readEventStream(session.run(message('Use updated session context.')))

    expect(JSON.parse(String(responsesFetch.instructions[0]))).toMatchObject({
      locale: 'zh-CN',
      product: 'docs',
      userId: 'u_123',
    })
  })

  it('throws when initial input is provided for an existing session', () => {
    const { agent } = createTestAgent()

    agent.session({ id: 'existing-session' })

    expect(() => agent.session({
      id: 'existing-session',
      input: [message('initial input')],
    })).toThrow('Session already exists: existing-session')
  })

  it('forks a session with committed history and context overlay', async () => {
    interface Context {
      locale: string
      userId?: string
    }

    const responsesFetch = createResponsesFetch()
    const agent = createAgent<Context>({
      context: { locale: 'en-US' },
      instructions: context => JSON.stringify(context),
      name: 'fork-context-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
    })
    const source = agent.session({
      context: { userId: 'source' },
      id: 'source-session',
    })

    await readEventStream(source.run(message('Committed source turn.')))

    const forked = await source.fork({
      context: { userId: 'fork' },
      id: 'fork-session',
    })

    expect(forked.id).toBe('fork-session')
    expect(forked).not.toBe(source)

    await readEventStream(forked.run(message('Fork turn.')))

    expect(responsesFetch.inputs[1]).toEqual([
      message('Committed source turn.'),
      assistantMessage('response 1'),
      message('Fork turn.'),
    ])
    expect(JSON.parse(String(responsesFetch.instructions[1]))).toEqual({
      locale: 'en-US',
      userId: 'fork',
    })
  })

  it('forks only committed history while the source session is active', async () => {
    const responsesFetch = createResponsesFetch(100)
    const agent = createAgent({
      instructions: 'You are a fork test assistant.',
      name: 'fork-active-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
    })
    const source = agent.session({ id: 'source-session' })

    await readEventStream(source.run(message('Committed source turn.')))

    const active = readEventStream(source.run(message('Active source turn.')))

    for (let i = 0; i < 200; i += 1) {
      if (responsesFetch.inputs.length >= 2)
        break

      await wait(5)
    }

    const forked = await source.fork({ id: 'fork-session' })

    await readEventStream(forked.run(message('Fork turn.')))
    await active

    expect(responsesFetch.inputs[2]).toEqual([
      message('Committed source turn.'),
      assistantMessage('response 1'),
      message('Fork turn.'),
    ])
  })

  it('throws when forking into an existing session id', async () => {
    const { agent } = createTestAgent()
    const source = agent.session({ id: 'source-session' })

    agent.session({ id: 'existing-session' })

    await expect(source.fork({ id: 'existing-session' })).rejects.toThrow('Session already exists: existing-session')
  })

  it('hydrates a persisted source session before forking and saves the target session', async () => {
    const storage = createMemoryStorage({
      '["fork-storage-test","source-session"]': JSON.stringify({
        context: { locale: 'en-US' },
        episodic: episodicFromItems([message('Persisted source turn.'), assistantMessage('persisted response')]),
        version: 7,
      }),
    })
    const agent = createAgent<{ locale?: string }>({
      instructions: 'You are a storage fork test assistant.',
      name: 'fork-storage-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: createResponsesFetch().fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage,
      }],
    })
    const source = agent.session({ id: 'source-session' })

    await source.fork({ id: 'fork-session' })

    const forkState = parseSessionState(storage.values.get('["fork-storage-test","fork-session"]'))
    expect(forkState.context).toEqual({ locale: 'en-US' })
    expect(typeof forkState.episodic).toBe('string')
    expect(forkState.version).toBe(0)
    expect(itemsFromEpisodic(forkState.episodic)).toEqual([message('Persisted source turn.'), assistantMessage('persisted response')])
  })

  it('removes an explicit session from memory and storage', async () => {
    const storage = createMemoryStorage()
    const responsesFetch = createResponsesFetch()
    const agent = createAgent({
      instructions: 'You are a remove test assistant.',
      name: 'remove-session-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage,
      }],
    })
    const session = agent.session({ id: 'remove-session' })

    await readEventStream(session.run(message('Persist before remove.')))
    expect(storage.values.has('["remove-session-test","remove-session"]')).toBe(true)

    await session.remove()

    expect(storage.values.has('["remove-session-test","remove-session"]')).toBe(false)
    expect(() => session.run(message('old handle'))).toThrow('Session removed: remove-session')

    const fresh = agent.session({ id: 'remove-session' })

    expect(fresh).not.toBe(session)

    await readEventStream(fresh.run(message('Fresh turn.')))

    expect(responsesFetch.inputs.at(-1)).toEqual([message('Fresh turn.')])
  })

  it('removes active and queued turns from an explicit session', async () => {
    const { agent } = createTestAgent(20)
    const session = agent.session({ id: 'remove-active-session' })
    let removing = false
    const unsubscribe = session.subscribe('apeira', (event) => {
      if (event.type !== 'turn.start' || removing)
        return

      removing = true
      queueMicrotask(() => {
        void session.remove()
      })
    })

    const first = readEventStream(session.run(message('Active turn.')))
    const second = readEventStream(session.run(message('Queued turn.')))
    const [firstEvents, secondEvents] = await Promise.all([first, second])

    unsubscribe()

    expect(firstEvents.map(event => event.type)).toContain('turn.aborted')
    expect(firstEvents.find(event => event.type === 'turn.aborted' && event.reason === 'removed')).toBeDefined()
    expect(secondEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: 'removed', type: 'turn.aborted' }),
    ]))
  })

  it('rejects removing the default session', async () => {
    const { agent } = createTestAgent()

    await expect(agent.session({ id: 'default' }).remove()).rejects.toThrow('Cannot remove default session: default')
  })

  it('rejects removed session handles', async () => {
    const { agent } = createTestAgent()
    const session = agent.session({ id: 'removed-handle-session' })

    await session.remove()

    expect(() => session.abort()).toThrow('Session removed: removed-handle-session')
    expect(() => session.clear()).toThrow('Session removed: removed-handle-session')
    expect(() => session.emit('test', {})).toThrow('Session removed: removed-handle-session')
    expect(() => session.getContext()).toThrow('Session removed: removed-handle-session')
    expect(() => session.interrupt()).toThrow('Session removed: removed-handle-session')
    expect(() => session.subscribe('apeira', () => {})).toThrow('Session removed: removed-handle-session')
    expect(() => session.run(message('old handle'))).toThrow('Session removed: removed-handle-session')
    expect(() => session.send(message('old handle'))).toThrow('Session removed: removed-handle-session')
    expect(() => session.setContext({})).toThrow('Session removed: removed-handle-session')
    expect(() => session.subscribe('test', () => {})).toThrow('Session removed: removed-handle-session')
    await expect(session.fork()).rejects.toThrow('Session removed: removed-handle-session')
    await expect(session.remove()).rejects.toThrow('Session removed: removed-handle-session')
  })

  it('keeps a session addressable when storage remove fails', async () => {
    const responsesFetch = createResponsesFetch()
    const storage = createMemoryStorage()
    const agent = createAgent({
      instructions: 'You are a remove failure test assistant.',
      name: 'remove-failure-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [{
        name: 'storage',
        storage: {
          getItem: key => storage.getItem(key),
          removeItem: () => {
            throw new Error('remove failed')
          },
          setItem: (key, value) => storage.setItem(key, value),
        },
      }],
    })
    const session = agent.session({ id: 'remove-failure-session' })

    await expect(session.remove()).rejects.toThrow('remove failed')

    expect(agent.session({ id: 'remove-failure-session' })).toBe(session)

    await readEventStream(session.run(message('Still usable.')))

    expect(responsesFetch.inputs.at(-1)).toEqual([message('Still usable.')])
  })

  it('runs different sessions with isolated queues and contexts', async () => {
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
      name: 'multi-session-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
    })
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))
    const first = agent.session({
      context: { userId: 'first' },
      id: 'first-session',
    })
    const second = agent.session({
      context: { userId: 'second' },
      id: 'second-session',
    })

    try {
      await Promise.all([
        readEventStream(first.run(message('First session.'))),
        readEventStream(second.run(message('Second session.'))),
      ])
    }
    finally {
      unsubscribe()
    }

    expect(new Set(events.map(event => event.sessionId))).toEqual(new Set([
      'first-session',
      'second-session',
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
    const unsubscribe = agent.subscribe('apeira', event => events.push(event))

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

    const unsubscribe = agent.subscribe('apeira', (event) => {
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

    const unsubscribe = agent.subscribe('apeira', (event) => {
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

    const unsubscribe = agent.subscribe('apeira', (event) => {
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
    const unsubscribe = agent.subscribe('apeira', (event) => {
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
    const unsubscribe = agent.subscribe('apeira', (event) => {
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

    const unsubscribe = agent.subscribe('apeira', (event) => {
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

  it('interrupts the active turn and lets the queue continue', async () => {
    const events: AgentEvent[] = []
    const { agent } = createTestAgent(2)
    let interrupted = false
    const unsubscribe = agent.subscribe('apeira', (event) => {
      events.push(event)

      if (event.type !== 'turn.start' || interrupted)
        return

      interrupted = true
      queueMicrotask(() =>
        agent.interrupt('test interrupt'),
      )
    })

    const first = readEventStream(agent.run(message('Interrupted turn.')))
    const second = readEventStream(agent.run(message('Next queued turn.')))
    const [firstEvents, secondEvents] = await Promise.all([first, second])
    unsubscribe()

    const firstTurnId = firstEvents[0]?.turnId
    const secondTurnId = secondEvents[0]?.turnId

    expect(firstEvents.map(event => event.type)).toContain('turn.aborted')
    expect(secondEvents.map(event => event.type)).toContain('turn.done')

    const abortedEvent = events.find(event =>
      event.turnId === firstTurnId && event.type === 'turn.aborted')
    expect(abortedEvent?.type === 'turn.aborted' && abortedEvent.reason).toBe('test interrupt')

    const secondQueuedEvent = events.find(event =>
      event.turnId === secondTurnId && event.type === 'turn.queued')
    const secondStartEvent = events.find(event =>
      event.turnId === secondTurnId && event.type === 'turn.start')
    expect(secondQueuedEvent).toBeDefined()
    expect(secondStartEvent).toBeDefined()
  })

  it('clears the running turn, queued turns, and pending input', async () => {
    const { agent } = createTestAgent(2)
    let cleared = false
    const unsubscribe = agent.subscribe('apeira', (event) => {
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
