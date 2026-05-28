import type { TranscriptEntry } from '../src/types/transcript'

import { describe, expect, it } from 'vitest'

import { createHitlReplayFetch, createHitlResumeInput } from '../../shared/hitl-demo'
import { appendTranscriptEntry, HITL_TRANSCRIPT_LIMIT, isHiddenHitlResumeInput } from '../src/utils/hitl-demo-transcript'

const readSseEvents = async (response: Response) => {
  const body = await response.text()
  return body
    .trim()
    .split('\n\n')
    .filter(Boolean)
    .map(chunk => JSON.parse(chunk.replace(/^data: /, '')) as Record<string, unknown>)
}

const userInput = (text: string) => ({
  content: [{ text, type: 'input_text' }],
  role: 'user',
  type: 'message',
})

const functionOutput = (output: string) => ({
  call_id: 'call_1',
  output,
  type: 'function_call_output',
})

const fetchEvents = async (input: unknown[], replay = createHitlReplayFetch()) =>
  readSseEvents(await replay.fetch('https://hitl-demo.invalid/v1/responses', {
    body: JSON.stringify({ input }),
    method: 'POST',
  }))

const completedOutput = (events: Record<string, unknown>[]) => {
  const completed = events.at(-1)?.response as undefined | { output?: Array<Record<string, unknown>> }
  return completed?.output ?? []
}

describe('pi-tui HITL demo helpers', () => {
  it('generates assistant text plus a tool call without using a real model', async () => {
    const output = completedOutput(await fetchEvents([userInput('please inspect status')]))

    expect(output[0]).toMatchObject({
      type: 'message',
    })
    expect(output[1]).toMatchObject({
      name: 'bash',
      type: 'function_call',
    })
  })

  it('summarizes approved and rejected resume paths', async () => {
    const approved = completedOutput(await fetchEvents([functionOutput('{"stdout":"ok"}')]))
    const rejected = completedOutput(await fetchEvents([functionOutput('TOOL_HITL_REJECTED: no')]))

    expect(JSON.stringify(approved)).toContain('模拟执行')
    expect(JSON.stringify(rejected)).toContain('用户拒绝')
  })

  it('replays approval-key as safe first and dangerous on the next request', async () => {
    const replay = createHitlReplayFetch()
    const first = completedOutput(await fetchEvents([userInput('approval-key')], replay))
    await fetchEvents([functionOutput('{"stdout":"demo: simulated git status"}')], replay)
    const second = completedOutput(await fetchEvents([userInput('approval-key')], replay))

    expect(JSON.stringify(first)).toContain('git status')
    expect(JSON.stringify(second)).toContain('rm -rf .')
  })

  it('can replay a turn-scope scenario with a repeated same-key tool call', async () => {
    const replay = createHitlReplayFetch()
    const first = completedOutput(await fetchEvents([userInput('hitl-demo turn')], replay))
    const resumed = completedOutput(await fetchEvents([userInput(createHitlResumeInput('hitl_call_turn', 'approved'))], replay))
    const repeated = completedOutput(await fetchEvents([functionOutput('{"stdout":"demo: simulated git diff --stat"}')], replay))
    const summary = completedOutput(await fetchEvents([functionOutput('{"stdout":"demo: simulated git diff --stat"}')], replay))

    expect(JSON.stringify(first)).toContain('git diff --stat')
    expect(JSON.stringify(resumed)).toContain('git diff --stat')
    expect(JSON.stringify(repeated)).toContain('同一轮恢复')
    expect(JSON.stringify(repeated)).toContain('git diff --stat')
    expect(JSON.stringify(summary)).toContain('模拟执行')
  })

  it('keeps hidden resume input out of user transcript entries and trims old entries', () => {
    const entries: TranscriptEntry[] = []
    const resumeInput = createHitlResumeInput('hitl_call_1', 'approved')

    expect(isHiddenHitlResumeInput(resumeInput)).toBe(true)

    for (let i = 0; i < HITL_TRANSCRIPT_LIMIT + 5; i += 1) {
      appendTranscriptEntry(entries, 'system', `entry ${i}`, {}, () => `id_${i}`)
    }

    expect(entries).toHaveLength(HITL_TRANSCRIPT_LIMIT)
    expect(entries[0]?.text).toBe('entry 5')
    expect(entries.some(entry => entry.role === 'user' && entry.text === resumeInput)).toBe(false)
  })
})
