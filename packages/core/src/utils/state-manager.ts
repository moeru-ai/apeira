import type { AgentState } from '../types/state'

export interface AgentStateManager {
  get: () => Readonly<AgentState>
  set: (next: ((prev: Readonly<AgentState>) => AgentState) | AgentState) => void
  update: (next: Partial<AgentState>) => void
}

export const createAgentStateManager = (
  initialState: AgentState,
  onChange?: (state: Readonly<AgentState>) => void,
): AgentStateManager => {
  let state = structuredClone(initialState)

  const set = (nextState: AgentState) => {
    state = structuredClone(nextState)
    onChange?.(state)
  }

  return {
    get: () => state,
    set: nextState =>
      set(typeof nextState === 'function' ? nextState(state) : nextState),
    update: nextState =>
      set({ ...state, ...nextState }),
  }
}
