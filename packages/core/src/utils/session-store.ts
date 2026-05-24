import type { AgentContext } from '../types/context'
import type { SessionState } from '../types/plugin'
import type { ItemParam } from '../types/responses'

export interface CommitSessionOptions {
  plugins?: Record<string, unknown>
}

export interface SessionStore<T = unknown> {
  append: (items: ItemParam[]) => void
  commit: (version: number, items: ItemParam[], options?: CommitSessionOptions) => boolean
  getContext: () => Partial<AgentContext<T>>
  getPluginState: (name: string) => unknown
  hydrate: (state: SessionState<T>) => void
  reset: () => void
  setContext: (context: Partial<AgentContext<T>>) => void
  setPluginState: (name: string, state: unknown) => void
  snapshot: () => SessionState<T>
}

const clonePlugins = (plugins?: Record<string, unknown>) =>
  plugins == null || Object.keys(plugins).length === 0
    ? undefined
    : { ...plugins }

export const createSessionStore = <T = unknown>(
  initialItems: ItemParam[] = [],
  initialContext: Partial<AgentContext<T>> = {},
): SessionStore<T> => {
  const initial = [...initialItems]
  const initialSessionContext = { ...initialContext }
  let items = [...initialItems]
  let context = { ...initialContext }
  let plugins: Record<string, unknown> | undefined
  let version = 0

  return {
    append: (nextItems) => {
      if (nextItems.length === 0)
        return

      items = [...items, ...nextItems]
      version += 1
    },
    commit: (expectedVersion, nextItems, options = {}) => {
      if (expectedVersion !== version)
        return false

      items = [...nextItems]
      plugins = clonePlugins(options.plugins ?? plugins)
      version += 1
      return true
    },
    getContext: () => ({ ...context }),
    getPluginState: name => plugins?.[name],
    hydrate: (state) => {
      items = [...state.items]
      context = { ...state.context }
      plugins = clonePlugins(state.plugins)
      version = state.version
    },
    reset: () => {
      items = [...initial]
      context = { ...initialSessionContext }
      plugins = undefined
      version += 1
    },
    setContext: (nextContext) => {
      context = { ...context, ...nextContext }
    },
    setPluginState: (name, state) => {
      const nextPlugins = { ...plugins }
      if (state === undefined)
        delete nextPlugins[name]
      else
        nextPlugins[name] = state

      plugins = clonePlugins(nextPlugins)
    },
    snapshot: () => ({
      context: { ...context },
      items: [...items],
      ...(plugins == null ? {} : { plugins: { ...plugins } }),
      version,
    }),
  }
}
