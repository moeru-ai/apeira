import type { AgentEvent } from '../src/index'

import { describe, expect, it } from 'vitest'

import { createAgent } from '../src/index'

const OLLAMA_BASE_URL = 'http://localhost:11434/v1/'
const OLLAMA_MODEL = 'qwen3.5:0.8b'

const waitForTurnDone = async (events: AgentEvent[], turnId: string) =>
  new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      const turnEvents = events.filter(event => event.turnId === turnId)
      const failed = turnEvents.find(event => event.type === 'turn.failed')
      const aborted = turnEvents.find(event => event.type === 'turn.aborted')

      if (failed != null) {
        clearInterval(timer)
        reject(failed.error)
        return
      }

      if (aborted != null) {
        clearInterval(timer)
        reject(new Error(`Turn aborted: ${String(aborted.reason)}`))
        return
      }

      if (turnEvents.some(event => event.type === 'turn.done')) {
        clearInterval(timer)
        resolve()
      }
    }, 10)
  })

const waitForTurnAborted = async (events: AgentEvent[], turnId: string) =>
  new Promise<void>((resolve, reject) => {
    const timer = setInterval(() => {
      const turnEvents = events.filter(event => event.turnId === turnId)
      const failed = turnEvents.find(event => event.type === 'turn.failed')

      if (failed != null) {
        clearInterval(timer)
        reject(failed.error)
        return
      }

      if (turnEvents.some(event => event.type === 'turn.done')) {
        clearInterval(timer)
        reject(new Error(`Turn completed before abort: ${turnId}`))
        return
      }

      if (turnEvents.some(event => event.type === 'turn.aborted')) {
        clearInterval(timer)
        resolve()
      }
    }, 10)
  })

describe('createAgent', () => {
  it('runs a turn against local Ollama responses API', async () => {
    const events: AgentEvent[] = []
    const agent = createAgent({
      instructions: 'You are a behavior test assistant. Answer briefly.',
      name: 'ollama-behavior-test',
      options: {
        apiKey: 'ollama',
        baseURL: OLLAMA_BASE_URL,
        maxOutputTokens: 128,
        model: OLLAMA_MODEL,
        temperature: 0,
      },
    })

    const unsubscribe = agent.subscribe(event => events.push(event))
    const turnId = agent.submit({
      content: 'Say pong in one short response.',
      role: 'user',
      type: 'message',
    })

    expect(turnId).toEqual(expect.any(String))
    expect(turnId).not.toHaveLength(0)

    try {
      await waitForTurnDone(events, turnId)
    }
    finally {
      unsubscribe()
    }

    const turnEvents = events.filter(event => event.turnId === turnId)
    const eventTypes = turnEvents.map(event => event.type)
    const stepDone = turnEvents.find(event => event.type === 'step.done')

    expect(eventTypes).toContain('turn.start')
    expect(eventTypes).toContain('step.start')
    expect(eventTypes).toContain('step.done')
    expect(eventTypes).toContain('turn.done')
    expect(eventTypes).not.toContain('turn.failed')
    expect(eventTypes).not.toContain('turn.aborted')
    expect(stepDone?.output?.length).toBeGreaterThan(0)
    expect(stepDone?.usage?.totalTokens).toBeGreaterThan(0)
  })

  it('queues submitted turns and runs them one at a time', async () => {
    const events: AgentEvent[] = []
    const agent = createAgent({
      instructions: 'You are a behavior test assistant. Answer briefly.',
      name: 'ollama-queue-test',
      options: {
        apiKey: 'ollama',
        baseURL: OLLAMA_BASE_URL,
        maxOutputTokens: 128,
        model: OLLAMA_MODEL,
        temperature: 0,
      },
    })

    const unsubscribe = agent.subscribe(event => events.push(event))
    const firstTurnId = agent.submit({
      content: 'Answer with a short first response.',
      role: 'user',
      type: 'message',
    })
    const secondTurnId = agent.submit({
      content: 'Answer with a short second response.',
      role: 'user',
      type: 'message',
    })

    try {
      await waitForTurnDone(events, firstTurnId)
      await waitForTurnDone(events, secondTurnId)
    }
    finally {
      unsubscribe()
    }

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

  it('aborts the running turn', async () => {
    const events: AgentEvent[] = []
    const agent = createAgent({
      instructions: 'You are a behavior test assistant. Answer briefly.',
      name: 'ollama-abort-test',
      options: {
        apiKey: 'ollama',
        baseURL: OLLAMA_BASE_URL,
        maxOutputTokens: 128,
        model: OLLAMA_MODEL,
        temperature: 0,
      },
    })

    let turnId: string
    const unsubscribe = agent.subscribe((event) => {
      events.push(event)

      if (event.turnId === turnId && event.type === 'turn.start') {
        agent.abort('test abort')
      }
    })

    turnId = agent.submit({
      content: 'Start a response that can be aborted.',
      role: 'user',
      type: 'message',
    })

    try {
      await waitForTurnAborted(events, turnId)
    }
    finally {
      unsubscribe()
    }

    const turnEvents = events.filter(event => event.turnId === turnId)
    const eventTypes = turnEvents.map(event => event.type)
    const aborted = turnEvents.find(event => event.type === 'turn.aborted')

    expect(eventTypes).toContain('turn.start')
    expect(eventTypes).toContain('turn.aborted')
    expect(eventTypes).not.toContain('turn.done')
    expect(eventTypes).not.toContain('turn.failed')
    expect(aborted?.reason).toBe('test abort')
  })

  it('clears the running turn and queued turns', async () => {
    const events: AgentEvent[] = []
    const agent = createAgent({
      instructions: 'You are a behavior test assistant. Answer briefly.',
      name: 'ollama-clear-test',
      options: {
        apiKey: 'ollama',
        baseURL: OLLAMA_BASE_URL,
        maxOutputTokens: 128,
        model: OLLAMA_MODEL,
        temperature: 0,
      },
    })

    let firstTurnId: string
    const unsubscribe = agent.subscribe((event) => {
      events.push(event)

      if (event.turnId === firstTurnId && event.type === 'turn.start') {
        agent.clear()
      }
    })

    firstTurnId = agent.submit({
      content: 'Start a response that will be cleared.',
      role: 'user',
      type: 'message',
    })
    const secondTurnId = agent.submit({
      content: 'This queued response should be cleared before it starts.',
      role: 'user',
      type: 'message',
    })

    try {
      await waitForTurnAborted(events, firstTurnId)
      await new Promise(resolve => setTimeout(resolve, 0))
    }
    finally {
      unsubscribe()
    }

    const firstTurnEvents = events.filter(event => event.turnId === firstTurnId)
    const firstEventTypes = firstTurnEvents.map(event => event.type)
    const firstAborted = firstTurnEvents.find(event => event.type === 'turn.aborted')
    const secondTurnEvents = events.filter(event => event.turnId === secondTurnId)

    expect(firstEventTypes).toContain('turn.start')
    expect(firstEventTypes).toContain('turn.aborted')
    expect(firstEventTypes).not.toContain('turn.done')
    expect(firstEventTypes).not.toContain('turn.failed')
    expect(firstAborted?.reason).toBe('cleared')
    expect(secondTurnEvents).toHaveLength(0)
  })
})
