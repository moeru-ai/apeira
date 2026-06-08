import { describe, expect, it } from 'vitest'

import { normalizeCard } from '../src/utils/normalize'
import { createV1Card, createV2Card, createV3Card } from './_shared'

describe('normalizeCard', () => {
  it('converts V1 and V2 cards to V3', () => {
    const v1 = normalizeCard(createV1Card())
    const v2 = normalizeCard(createV2Card())

    expect(v1.spec).toBe('chara_card_v3')
    expect(v2.spec).toBe('chara_card_v3')
  })

  it('uses a V3.0 card as-is', () => {
    const card = createV3Card()
    const result = normalizeCard(card)

    expect(result).toBe(card)
  })

  it('rejects unsupported V3 versions and unknown inputs', () => {
    // @ts-expect-error unsupported runtime version
    expect(() => normalizeCard({
      ...createV3Card(),
      spec_version: '3.1',
    })).toThrow(TypeError)
    // @ts-expect-error invalid runtime version
    expect(() => normalizeCard({
      ...createV3Card(),
      spec_version: '2.0',
    })).toThrow(TypeError)
    // @ts-expect-error invalid runtime version
    expect(() => normalizeCard({
      ...createV3Card(),
      spec_version: 'not-a-version',
    })).toThrow(TypeError)
    // @ts-expect-error invalid runtime version
    expect(() => normalizeCard({
      ...createV3Card(),
      spec_version: '3',
    })).toThrow(TypeError)
    // @ts-expect-error invalid runtime card
    expect(() => normalizeCard({ hello: 'world' })).toThrow(TypeError)
  })
})
