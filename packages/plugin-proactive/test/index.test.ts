import type { AgentEvent, ItemParam, StorageLike } from '@apeira/core'

import { createAgent } from '@apeira/core'
import { describe, expect, it, vi } from 'vitest'

import { proactive } from '../src/index'
import { Scheduler } from '../src/scheduler'
import { createBriefTool } from '../src/tools/brief'

// eslint-disable-next-line @masknet/prefer-timer-id
const sleep = async (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms))

const message = (content: string): ItemParam => ({
  content,
  role: 'user',
  type: 'message',
})

const assistantMessage = (text: string): ItemParam => ({
  content: [{ text, type: 'output_text' }],
  phase: 'final_answer',
  role: 'assistant',
  type: 'message',
})

const sse = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`

const createResponseStream = (text: string, signal?: AbortSignal) => {
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
        await sleep(5)
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
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
        },
        type: 'response.completed',
      })
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

const createMockFetch = () => {
  const bodies: Array<{ input: unknown[], instructions?: unknown, tools?: unknown[] }> = []
  const inputs: unknown[][] = []
  const instructions: unknown[] = []

  const fetch: typeof globalThis.fetch = async (_url, init) => {
    const signal = init?.signal instanceof AbortSignal ? init.signal : undefined
    if (signal?.aborted)
      throw signal.reason ?? new DOMException('Aborted', 'AbortError')

    const body = JSON.parse(String(init?.body)) as { input: unknown[], instructions?: unknown, tools?: unknown[] }
    bodies.push(body)
    inputs.push(body.input)
    instructions.push(body.instructions)

    return createResponseStream(`response ${inputs.length}`, signal)
  }

  return { bodies, fetch, inputs, instructions }
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

const createTestAgent = (plugins?: Parameters<typeof createAgent>[0]['plugins']) => {
  const { bodies, fetch, inputs, instructions } = createMockFetch()
  const agent = createAgent({
    instructions: 'You are a test assistant.',
    name: 'proactive-test',
    options: {
      apiKey: 'test',
      baseURL: 'https://example.test/v1/',
      fetch,
      maxOutputTokens: 128,
      model: 'test-model',
      temperature: 0,
    },
    plugins,
  })
  return { agent, bodies, inputs, instructions }
}

const itemHasText = (item: unknown, text: string): boolean =>
  typeof item === 'object' && item != null
  && typeof (item as Record<string, unknown>).content === 'string'
  && ((item as Record<string, unknown>).content as string).includes(text)

describe('proactive plugin', () => {
  it('extends instructions with proactive guide', async () => {
    const { agent, instructions } = createTestAgent([proactive()])
    const events = await readEventStream(agent.run(message('hello')))
    expect(events.some(e => e.type === 'turn.done')).toBe(true)
    expect(String(instructions[0])).toContain('<tick')
  })

  it('provides proactive tools', async () => {
    const { agent, bodies } = createTestAgent([proactive()])
    await readEventStream(agent.run(message('hello')))
    const tools = bodies[0]?.tools ?? []
    const toolNames = tools.map(t => (t as { name?: string }).name)
    expect(toolNames).toContain('sleep')
    expect(toolNames).toContain('schedule_task')
    expect(toolNames).toContain('create_todo')
    expect(toolNames).toContain('pause_proactive')
    expect(toolNames).toContain('send_brief')
  })

  it('injects proactive context via extendInput when there are todos', async () => {
    const storage: StorageLike = {
      getItem: () => JSON.stringify({
        dmn: { lastTickAt: 0, lastUserInputAt: 0, state: 'resting' },
        tasks: [],
        todos: [
          { createdAt: Date.now(), id: 't1', status: 'pending', title: 'review code' },
        ],
      }),
      removeItem: () => {},
      setItem: () => {},
    }

    const { agent, inputs } = createTestAgent([proactive({ storage })])
    await readEventStream(agent.run(message('hello')))

    const firstInput = inputs[0]
    const hasProactiveContext = firstInput.some(item => itemHasText(item, 'proactive_context'))
    expect(hasProactiveContext).toBe(true)
  })

  it('does not inject proactive context when empty', async () => {
    const { agent, inputs } = createTestAgent([proactive()])
    await readEventStream(agent.run(message('hello')))

    const firstInput = inputs[0]
    const hasProactiveContext = firstInput.some(item => itemHasText(item, 'proactive_context'))
    expect(hasProactiveContext).toBe(false)
  })

  it('sends tick when session is in resting state after user inactivity', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    const { agent, inputs } = createTestAgent([proactive()])

    const events1 = await readEventStream(agent.run(message('hello')))
    expect(events1.some(e => e.type === 'turn.done')).toBe(true)

    vi.advanceTimersByTime(300_000 + 100)
    await sleep(50)

    const hasTickInput = inputs.some((inputArray: unknown) =>
      Array.isArray(inputArray)
      && inputArray.some(item => itemHasText(item, '<tick')),
    )

    expect(hasTickInput).toBe(true)
    vi.useRealTimers()
  })

  it('persists state to storage', async () => {
    const stored: Record<string, string> = {}
    const storage: StorageLike = {
      getItem: () => undefined,
      removeItem: () => {},
      setItem: (key, value) => { stored[key] = value },
    }

    const { agent } = createTestAgent([proactive({ storage })])
    await readEventStream(agent.run(message('hello')))
    await sleep(200)

    const proactiveKey = Object.keys(stored).find(k => k.endsWith(',"proactive"]'))
    expect(proactiveKey).toBeDefined()
    const raw = stored[proactiveKey!]
    expect(raw).toBeDefined()
    const state = JSON.parse(raw ?? '') as { dmn: unknown, tasks: unknown[], todos: unknown[] }
    expect(state.dmn).toBeDefined()
    expect(state.tasks).toEqual([])
    expect(state.todos).toEqual([])
  })

  it('restores state from storage on new session', async () => {
    const stored: Record<string, string> = {
      '["proactive-test","session-1","proactive"]': JSON.stringify({
        dmn: { lastTickAt: 0, lastUserInputAt: 0, state: 'resting' },
        tasks: [{ at: Date.now() + 86_400_000, description: 'daily check', id: 'task1', type: 'once' }],
        todos: [{ createdAt: Date.now(), id: 't1', status: 'in_progress', title: 'build feature' }],
      }),
    }

    const storage: StorageLike = {
      getItem: key => stored[key],
      removeItem: () => {},
      setItem: () => {},
    }

    const { agent, inputs } = createTestAgent([proactive({ storage })])
    const session = agent.session({ id: 'session-1' })
    await readEventStream(session.run(message('hello')))

    const firstInput = inputs[0]
    const hasTodo = firstInput.some(item => itemHasText(item, 'build feature'))
    expect(hasTodo).toBe(true)
  })
})

describe('scheduler', () => {
  it('interval tasks become due after interval passes', () => {
    vi.useFakeTimers()
    const scheduler = new Scheduler()
    scheduler.add({ description: 'check', interval: 60_000, type: 'interval' })

    expect(scheduler.due().length).toBe(0)

    vi.advanceTimersByTime(60_000)
    expect(scheduler.due().length).toBe(1)

    vi.useRealTimers()
  })

  it('interval tasks respect lastTriggeredAt', () => {
    vi.useFakeTimers()
    const scheduler = new Scheduler()
    scheduler.add({ description: 'check', interval: 60_000, type: 'interval' })

    vi.advanceTimersByTime(60_000)
    const firstDue = scheduler.due()
    expect(firstDue.length).toBe(1)

    // Mark as triggered
    firstDue[0].lastTriggeredAt = Date.now()

    // Immediately check again — should not be due
    expect(scheduler.due().length).toBe(0)

    vi.advanceTimersByTime(60_000)
    expect(scheduler.due().length).toBe(1)

    vi.useRealTimers()
  })
})

describe('send_brief', () => {
  it('calls send with message content', async () => {
    const sent: ItemParam[] = []
    const send = (input: ItemParam) => {
      sent.push(input)
      return 'msg-id'
    }
    const briefTool = await createBriefTool(send)
    const result = briefTool.execute({ content: 'hello', importance: 'high' }, { messages: [], toolCallId: '' })
    expect(sent.length).toBe(1)
    expect(sent[0]).toMatchObject({ content: 'hello', role: 'assistant', type: 'message' })
    expect(result).toBe('Brief sent.')
  })
})
