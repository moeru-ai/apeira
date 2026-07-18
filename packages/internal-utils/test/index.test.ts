import { describe, expect, it } from 'vitest'

import { raceAbort, stableStringify } from '../src/index'

describe('raceAbort', () => {
  it('returns the original promise result', async () => {
    await expect(raceAbort(Promise.resolve('done'), new AbortController().signal))
      .resolves
      .toBe('done')
  })

  it('rejects with the abort reason without waiting for the promise', async () => {
    const controller = new AbortController()
    const result = raceAbort(new Promise<never>(() => {}), controller.signal)
    controller.abort('stop')

    await expect(result).rejects.toBe('stop')
  })
})

describe('stableStringify', () => {
  it('sorts nested object keys while preserving array order', () => {
    const nested: Record<string, number> = {}
    nested.d = 4
    nested.c = 3
    const value: Record<string, unknown> = {}
    value.b = 2
    value.a = [nested]

    expect(stableStringify(value))
      .toBe('{"a":[{"c":3,"d":4}],"b":2}')
  })
})
