import type { AssembleInput, Episodic, SliceResult } from '../episodic'
import type { AgentContext } from '../types/context'
import type { SessionState } from '../types/plugin'
import type { ItemParam } from '../types/responses'

import { createEpisodic, createSlice } from '../episodic'

export interface SessionStore<T = unknown> {
  assemble: (input?: AssembleInput) => SliceResult
  readonly episodic: Episodic
  fork: () => SessionStore<T>
  getContext: () => Partial<AgentContext<T>>
  hydrate: (state: SessionState<T>) => void
  merge: (session: SessionStore<T>) => void
  reset: () => void
  setContext: (context: Partial<AgentContext<T>>) => void
  snapshot: () => SessionState<T>
}

export const createSessionStore = <T = unknown>(
  initialItems: ItemParam[] = [],
  initialContext: Partial<AgentContext<T>> = {},
  initialEpisodic?: string,
): SessionStore<T> => {
  const initialSessionContext = { ...initialContext }
  const slice = createSlice()
  let episodic = createEpisodic(initialEpisodic)
  let context = { ...initialContext }
  let version = 0

  if (initialEpisodic == null)
    episodic.appendItems(initialItems, { source: 'user' })

  return ({
    assemble: (input = {}) => slice(episodic, input),
    get episodic() {
      return episodic
    },
    fork: () => createSessionStore<T>([], context, episodic.toJSONL()),
    getContext: () => ({ ...context }),
    hydrate: (state) => {
      episodic = createEpisodic(state.episodic)
      context = { ...state.context }
      version = state.version
    },
    merge: (session) => {
      const lastId = episodic.read({ fromId: 0 }).at(-1)?.id ?? 0
      const nextEpisodes = session.episodic.read({ fromId: lastId })

      episodic.importEpisodes(nextEpisodes)

      if (nextEpisodes.length > 0)
        version += 1
    },
    reset: () => {
      episodic = createEpisodic()
      context = { ...initialSessionContext }
      version += 1
    },
    setContext: (nextContext) => {
      context = { ...context, ...nextContext }
    },
    snapshot: () => ({
      context: { ...context },
      episodic: episodic.toJSONL(),
      version,
    }),
  })
}
