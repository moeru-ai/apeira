import type { AgentEvent, ItemParam } from '@apeira/core'

import { createAgent } from '@apeira/core'
import { hitl } from '@apeira/plugin-hitl'
import { describe, expect, it } from 'vitest'

import { createHitlDemoTools, createHitlReplayFetch } from '../../shared/hitl-demo'

const userInput = (content: string): ItemParam => ({
  content,
  role: 'user',
  type: 'message',
})

const readEvents = async (stream: ReadableStream<AgentEvent>) => {
  const reader = stream.getReader()
  const events: AgentEvent[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break

    events.push(value)
  }

  return events
}

const readEventsAndDecide = async (
  stream: ReadableStream<AgentEvent>,
  decide: (id: string) => void,
) => {
  const reader = stream.getReader()
  const events: AgentEvent[] = []
  let decided = false

  while (true) {
    const { done, value } = await reader.read()
    if (done)
      break

    events.push(value)
    if (!decided && value.type === 'tool-interruption') {
      decided = true
      decide(value.interruption.id)
    }
  }

  return events
}

const createDemoSession = () => {
  const controller = hitl({ mode: 'ask' })
  const replay = createHitlReplayFetch()
  const agent = createAgent({
    instructions: 'Run deterministic HITL demo tool calls.',
    name: 'hitl-runtime-test',
    options: {
      apiKey: 'hitl-demo',
      baseURL: 'https://hitl-demo.invalid/v1/',
      fetch: replay.fetch,
      model: 'hitl-demo-replay',
      tools: createHitlDemoTools(),
    },
    plugins: [controller.plugin],
  })

  return {
    controller,
    session: agent.session({ id: crypto.randomUUID() }),
  }
}

const interruptions = (events: AgentEvent[]) =>
  events.filter((event): event is Extract<AgentEvent, { type: 'tool-interruption' }> => event.type === 'tool-interruption')

const text = (events: AgentEvent[]) =>
  events.flatMap(event => event.type === 'text.done' ? [event.text] : []).join('\n')

describe('hitl demo runtime integration', () => {
  it('asks again after a call-scope approval', async () => {
    const { controller, session } = createDemoSession()
    const first = await readEventsAndDecide(
      session.run(userInput('hitl-demo once')),
      id => expect(controller.approve(id, 'call')).toBe(true),
    )
    const id = interruptions(first)[0].interruption.id

    expect(id).toBeDefined()

    const second = await readEventsAndDecide(
      session.run(userInput('hitl-demo once')),
      id => expect(controller.reject(id)).toBe(true),
    )
    expect(interruptions(second)).toHaveLength(1)
  })

  it('lets run-scope approval continue repeated same-key calls in one resumed turn only', async () => {
    const { controller, session } = createDemoSession()
    const first = await readEventsAndDecide(
      session.run(userInput('hitl-demo turn')),
      id => expect(controller.approve(id, 'run')).toBe(true),
    )
    const id = interruptions(first)[0].interruption.id

    expect(id).toBeDefined()

    const nextTurn = await readEventsAndDecide(
      session.run(userInput('hitl-demo turn')),
      id => expect(controller.reject(id)).toBe(true),
    )
    expect(interruptions(nextTurn)).toHaveLength(1)
  })

  it('remembers conversation-scope approvals by exact key', async () => {
    const { controller, session } = createDemoSession()
    const first = await readEventsAndDecide(
      session.run(userInput('hitl-demo conversation')),
      id => expect(controller.approve(id, 'conversation')).toBe(true),
    )
    const id = interruptions(first)[0].interruption.id

    expect(id).toBeDefined()

    const sameKey = await readEvents(session.run(userInput('hitl-demo conversation')))
    expect(interruptions(sameKey)).toHaveLength(0)
  })

  it('keeps approval-key exact after a conversation approval', async () => {
    const { controller, session } = createDemoSession()
    const first = await readEventsAndDecide(
      session.run(userInput('hitl-demo approval-key')),
      id => expect(controller.approve(id, 'conversation')).toBe(true),
    )
    const id = interruptions(first)[0].interruption.id

    expect(id).toBeDefined()

    const dangerous = await readEventsAndDecide(
      session.run(userInput('hitl-demo approval-key')),
      id => expect(controller.reject(id)).toBe(true),
    )
    expect(JSON.stringify(dangerous)).toContain('rm -rf .')
    expect(interruptions(dangerous)).toHaveLength(1)
  })

  it('returns a model-visible rejection summary', async () => {
    const { controller, session } = createDemoSession()
    const events = await readEventsAndDecide(
      session.run(userInput('hitl-demo reject')),
      id => expect(controller.reject(id, 'TOOL_HITL_REJECTED: denied in demo')).toBe(true),
    )

    expect(interruptions(events)[0].interruption.id).toBeDefined()
    expect(text(events)).toContain('用户拒绝')
  })
})
