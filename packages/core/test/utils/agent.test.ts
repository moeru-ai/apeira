import type { Tool } from '@xsai/shared-chat'

import type { AgentEvent } from '../../src/index'

import { describe, expect, it } from 'vitest'

import { createAgent } from '../../src/index'
import {
  assistantMessage,
  createMemoryStorage,
  createResponsesFetch,
  createTestAgent,
  episodicFromItems,
  itemsFromEpisodic,
  message,
  parseSessionState,
  readEventStream,
  usageFromEpisodic,
  wait,
  waitForTurnDone,
} from '../_shared'

describe('createAgent', () => {
  it('loads persisted session state before clear saves reset state', async () => {
    const storage = createMemoryStorage({
      '["clear-storage-test","clear-storage-test"]': JSON.stringify({
        context: { locale: 'en-US' },
        episodic: episodicFromItems([message('persisted history')]),
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

    expect(JSON.parse(String(storage.values.get('["clear-storage-test","clear-storage-test"]')))).toEqual({
      context: {},
      episodic: '',
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
      '["plugin-test","plugin-test"]': JSON.stringify({
        context: {},
        episodic: episodicFromItems([message('loaded history')]),
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
        extendInput: ({ input }) => {
          calls.push(`extendInput:${input.length}`)
          return [message('temporary plugin input')]
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
      message('temporary plugin input'),
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
      'extendInput:1',
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

  it('extends each model input without persisting extension items', async () => {
    const records: Array<{ input?: unknown, requestId?: string }> = []
    const responsesFetch = createResponsesFetch(2)
    const storage = createMemoryStorage()
    const agent = createAgent<{ requestId?: string }>({
      instructions: 'You are a plugin test assistant.',
      name: 'extend-input-test',
      options: {
        apiKey: 'test',
        baseURL: 'https://example.test/v1/',
        fetch: responsesFetch.fetch,
        model: 'test-model',
      },
      plugins: [{
        extendInput: ({ context, input }) => {
          records.push({ input: input.at(-1), requestId: context.requestId })
          return [message(`extension:${context.requestId ?? 'none'}`)]
        },
        name: 'input-extender',
        storage: {
          getItem: key => storage.getItem(key),
          removeItem: key => storage.removeItem(key),
          setItem: (key, value) => storage.setItem(key, value),
        },
      }],
    })
    const events: AgentEvent[] = []
    let turnId: string
    let followUpQueued = false

    const unsubscribe = agent.subscribe('apeira', (event) => {
      events.push(event)

      if (event.turnId === turnId && event.type === 'step.start' && !followUpQueued) {
        followUpQueued = true
        agent.send(message('Follow up.'), {
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

    expect(records).toEqual([
      { input: message('Initial turn.'), requestId: 'initial' },
      { input: message('Follow up.'), requestId: 'follow' },
    ])
    expect(responsesFetch.inputs[0]).toContainEqual(message('extension:initial'))
    expect(responsesFetch.inputs[1]).toContainEqual(message('extension:follow'))

    const state = parseSessionState(storage.values.get('["extend-input-test","extend-input-test"]'))
    expect(itemsFromEpisodic(state.episodic)).not.toContainEqual(message('extension:initial'))
    expect(itemsFromEpisodic(state.episodic)).not.toContainEqual(message('extension:follow'))
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

    await expect(agent.session({ id: 'scheduler-test' }).remove()).rejects.toThrow('Cannot remove default session: scheduler-test')
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
