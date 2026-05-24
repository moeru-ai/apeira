import { describe, expect, it } from 'vitest'

import { runScenario } from '../src/scenarios'

const hasDeniedResult = (inputs: unknown[][]) =>
  inputs.some(input => JSON.stringify(input).includes('TOOL_APPROVAL_DENIED'))

describe('tool approval CLI scenarios', () => {
  it('asks again for once approvals', async () => {
    const result = await runScenario({ choices: ['once', 'deny'], scenario: 'once' })

    expect(result.approvalPrompts).toHaveLength(2)
    expect(result.toolExecutions).toHaveLength(1)
  })

  it('remembers turn approvals only within the same turn', async () => {
    const result = await runScenario({ choices: ['turn', 'deny'], scenario: 'turn' })

    expect(result.approvalPrompts).toHaveLength(2)
    expect(result.toolExecutions).toHaveLength(2)
    expect(result.approvalEvents.some(event => event.source === 'turn_cache')).toBe(true)
  })

  it('remembers conversation approvals in private state', async () => {
    const result = await runScenario({ choices: ['conversation'], scenario: 'conversation' })

    expect(result.approvalPrompts).toHaveLength(1)
    expect(result.toolExecutions).toHaveLength(2)
    expect(result.approvalEvents.some(event => event.source === 'context_history')).toBe(true)
    expect(JSON.stringify([...result.storage.values.values()])).toContain('@apeira/plugin-tool-approval')
  })

  it('returns a model-visible denial when denied', async () => {
    const result = await runScenario({ choices: ['deny'], scenario: 'deny' })

    expect(result.toolExecutions).toHaveLength(0)
    expect(hasDeniedResult(result.modelInputs)).toBe(true)
  })

  it('does not reuse approval across different command inputs', async () => {
    const result = await runScenario({ choices: ['conversation', 'deny'], scenario: 'approval-key' })

    expect(result.approvalPrompts).toHaveLength(2)
    expect(result.toolExecutions).toHaveLength(1)
    expect(hasDeniedResult(result.modelInputs)).toBe(true)
  })

  it('lets runtime deny mode override old conversation approvals', async () => {
    const result = await runScenario({ choices: ['conversation'], scenario: 'runtime-policy-switch' })

    expect(result.approvalPrompts).toHaveLength(1)
    expect(result.toolExecutions).toHaveLength(1)
    expect(hasDeniedResult(result.modelInputs)).toBe(true)
  })
})
