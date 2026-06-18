import type { AgentState } from '../types/state'

export interface AgentStateManager {
  get: () => Readonly<AgentState>
  restore: (next: AgentState) => void
  set: (next: ((prev: Readonly<AgentState>) => AgentState) | AgentState) => void
  update: (next: Partial<AgentState>) => void
}

export const createAgentStateManager = (
  initialState: AgentState,
  onChange?: (state: Readonly<AgentState>) => void,
): AgentStateManager => {
  let state = structuredClone(initialState)

  const set = (nextState: AgentState, silent = false) => {
    state = structuredClone(nextState)
    if (!silent)
      onChange?.(state)
  }

  return {
    get: () => state,
    restore: nextState => set(nextState, true),
    set: nextState =>
      set(typeof nextState === 'function' ? nextState(state) : nextState),
    update: nextState =>
      set({ ...state, ...nextState }),
  }
}
