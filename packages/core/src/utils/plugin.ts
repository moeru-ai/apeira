import type { AgentEntry } from '../types/entry'
import type { AgentPlugin, AgentPluginOption } from '../types/plugin'

type PrepareStepHook = NonNullable<AgentPlugin['prepareStep']>
type TransformEntriesHook = NonNullable<AgentPlugin['transformEntries']>

export const normalizePlugins = (options: AgentPluginOption[]): AgentPlugin[] => {
  const plugins = options.flatMap((option) => {
    if (option == null || option === false)
      return []
    if (Array.isArray(option))
      return normalizePlugins(option)
    return [option]
  })

  const order = { post: 2, pre: 0 } as const
  return plugins.sort(
    (a, b) => (order[a.enforce as keyof typeof order] ?? 1) - (order[b.enforce as keyof typeof order] ?? 1),
  )
}

export const chain = <H extends (...args: never[]) => unknown>(
  mode: 'every' | 'some',
  hooks: (H | undefined)[],
): H | undefined => {
  const list = hooks.filter(Boolean) as H[]
  if (list.length === 0)
    return undefined

  return (async (...args: Parameters<H>) => {
    for (const hook of list) {
      const result = await hook(...args)
      if (result != null && mode === 'some')
        return result
    }
    return undefined
  }) as H
}

export const chainPrepareStep = (
  hooks: (PrepareStepHook | undefined)[],
): AgentPlugin['prepareStep'] => {
  const list = hooks.filter(Boolean) as PrepareStepHook[]
  if (list.length === 0)
    return undefined

  return async (stepOptions) => {
    let current = { ...stepOptions }
    let prepared: Awaited<ReturnType<PrepareStepHook>> | undefined

    for (const hook of list) {
      const result = await hook(current)
      if (result != null) {
        prepared = { ...prepared, ...result }
        current = { ...current, ...result }
      }
    }

    return prepared ?? {}
  }
}

export const chainTransformEntries = (
  hooks: (TransformEntriesHook | undefined)[],
): AgentPlugin['transformEntries'] => {
  const list = hooks.filter(Boolean) as TransformEntriesHook[]
  if (list.length === 0)
    return undefined

  return async (entries, options) => {
    let current: readonly AgentEntry[] = entries

    for (const hook of list)
      current = await hook(current, options)

    return current
  }
}
