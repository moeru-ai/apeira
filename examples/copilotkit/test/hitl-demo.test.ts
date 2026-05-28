import { describe, expect, it } from 'vitest'

import { createHitlDemoTools, createHitlReplayFetch, createHitlResumeInput } from '../../shared/hitl-demo'

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

const completedOutput = (events: Record<string, unknown>[]) => {
  const completed = events.at(-1)?.response as undefined | { output?: Array<Record<string, unknown>> }
  return completed?.output ?? []
}

const fetchOutput = async (input: unknown[], replay = createHitlReplayFetch({ toolName: 'weather' })) =>
  completedOutput(await readSseEvents(await replay.fetch('https://hitl-demo.invalid/v1/responses', {
    body: JSON.stringify({ input }),
    method: 'POST',
  })))

describe('copilotkit HITL demo replay', () => {
  it('returns a deterministic weather tool call for the review card flow', async () => {
    const output = await fetchOutput([userInput('start conversation demo')])

    expect(output[0]).toMatchObject({
      type: 'message',
    })
    expect(output[1]).toMatchObject({
      name: 'weather',
      type: 'function_call',
    })
  })

  it('keeps approval-key matching exact by producing a dangerous second request', async () => {
    const replay = createHitlReplayFetch({ toolName: 'weather' })
    const first = await fetchOutput([userInput('approval-key')], replay)
    await fetchOutput([functionOutput('{"stdout":"demo: simulated git status"}')], replay)
    const second = await fetchOutput([userInput('approval-key')], replay)

    expect(JSON.stringify(first)).toContain('git status')
    expect(JSON.stringify(second)).toContain('rm -rf .')
  })

  it('provides safe mock tools and hidden resume payloads for UI buttons', async () => {
    const tools = createHitlDemoTools()
    const bash = tools.find(tool => tool.function.name === 'bash')
    const weather = tools.find(tool => tool.function.name === 'weather')

    expect(bash?.execute({ command: 'rm -rf .' })).toMatchObject({
      stdout: 'demo: simulated rm -rf .',
    })
    expect(weather?.execute({ city: 'Taipei' })).toMatchObject({
      forecast: 'sunny',
    })
    expect(createHitlResumeInput('hitl_call_1', 'approved')).toContain('decision="approved"')
  })

  it('uses a fresh tool call id when resuming a reviewed call', async () => {
    const replay = createHitlReplayFetch({ toolName: 'weather' })
    const first = await fetchOutput([userInput('once')], replay)
    const firstCall = first.find(item => item.type === 'function_call')

    expect(firstCall).toMatchObject({
      call_id: 'call_weather_1',
      type: 'function_call',
    })

    const resumed = await fetchOutput([userInput(createHitlResumeInput('hitl_call_weather_1', 'approved'))], replay)
    const resumedCall = resumed.find(item => item.type === 'function_call')

    expect(resumedCall).toMatchObject({
      call_id: 'call_weather_1_resume_2',
      type: 'function_call',
    })
    expect(resumedCall?.arguments).toBe(firstCall?.arguments)
  })
})
