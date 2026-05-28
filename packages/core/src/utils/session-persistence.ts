import type { AgentPlugin, SessionState } from '../types/plugin'

export const getSessionStorageKey = (agentName: string, sessionId: string) =>
  JSON.stringify([agentName, sessionId])

export const parseSessionState = <T>(value: null | string | undefined): SessionState<T> | undefined => {
  if (value == null)
    return undefined

  try {
    const state = JSON.parse(value) as Partial<SessionState<T>>

    if (state == null || typeof state.episodic !== 'string' || typeof state.context !== 'object' || state.context == null)
      return undefined

    return state as SessionState<T>
  }
  catch {
    return undefined
  }
}

export interface SessionPersistence<T> {
  load: (sessionId: string) => Promise<SessionState<T> | undefined>
  remove: (sessionId: string) => Promise<void>
  save: (sessionId: string, state: SessionState<T>) => Promise<void>
}

export const createSessionPersistence = <T>(
  agentName: string,
  plugins: AgentPlugin<T>[],
): SessionPersistence<T> => {
  const withSessionStorage = async (
    sessionId: string,
    fn: (storage: NonNullable<AgentPlugin<T>['storage']>, key: string) => Promise<void> | void,
  ) => {
    const key = getSessionStorageKey(agentName, sessionId)
    await Promise.all(
      plugins
        .filter(plugin => plugin.storage != null)
        .map(async plugin => fn(plugin.storage!, key)),
    )
  }

  return {
    load: async (sessionId) => {
      const key = getSessionStorageKey(agentName, sessionId)

      for (const plugin of plugins) {
        if (plugin.storage == null)
          continue

        const value = await plugin.storage.getItem(key)
        const state = parseSessionState<T>(value)

        if (state != null)
          return state
      }
    },
    remove: async sessionId =>
      withSessionStorage(sessionId, async (storage, key) => storage.removeItem(key)),
    save: async (sessionId, state) =>
      withSessionStorage(sessionId, async (storage, key) => storage.setItem(key, JSON.stringify(state))),
  }
}
