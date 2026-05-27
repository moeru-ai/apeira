export type DmnState = 'foraging' | 'paused' | 'resting' | 'working'

export const DMN_TICK_INTERVALS: Record<DmnState, null | number> = {
  foraging: 30000,
  paused: null,
  resting: 300000,
  working: 3000,
}

export interface DmnContext {
  lastTickAt: number
  lastUserInputAt: number
  state: DmnState
}

export const createDmnContext = (): DmnContext => ({
  lastTickAt: 0,
  lastUserInputAt: 0,
  state: 'resting',
})

/**
 * Compute next DMN state based on turn result
 * - tool calls made → working
 * - no tool calls → decays from working → foraging → resting
 * - paused stays unchanged
 */
export const nextDmnState = (
  current: DmnContext,
  hasToolCalls: boolean,
  modelSlept: boolean,
): DmnState => {
  if (current.state === 'paused')
    return 'paused'

  if (modelSlept)
    return 'resting'

  if (hasToolCalls)
    return 'working'

  if (current.state === 'working')
    return 'foraging'

  if (current.state === 'foraging')
    return 'resting'

  return 'resting'
}

export const shouldSkipTick = (ctx: DmnContext): boolean =>
  Date.now() - ctx.lastUserInputAt < 5000
