import { describe, expect, it } from 'vitest'

import { selectGreeting } from '../src/utils/greeting'
import { createV3Card } from './_shared'

describe('selectGreeting', () => {
  const card = createV3Card({
    alternate_greetings: ['Second', 'Third'],
    first_mes: 'First',
  })

  it('selects first and alternate greetings', () => {
    expect(selectGreeting(card, 0)).toEqual({ greeting: 'First', index: 0 })
    expect(selectGreeting(card, 2)).toEqual({ greeting: 'Third', index: 2 })
  })

  it('falls back to first_mes for invalid indices', () => {
    expect(selectGreeting(card, -1)).toEqual({ greeting: 'First', index: 0 })
    expect(selectGreeting(card, 3)).toEqual({ greeting: 'First', index: 0 })
    expect(selectGreeting(card, 1.5)).toEqual({ greeting: 'First', index: 0 })
  })
})
