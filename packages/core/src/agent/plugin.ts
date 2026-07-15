import type {
  CompletionStep,
  PostToolCall,
  PrepareStep,
  PreToolCall,
  Tool,
  Usage,
} from '@xsai/shared-chat'

import type { MaybePromise } from '../types'
import type { AgentEntry } from './entry'
import type { Agent } from './index'
import type { AgentInput } from './input'
import type { AgentState } from './state'

export interface AgentPlugin {
  enforce?: 'post' | 'pre'
  extendInstructions?: (options: ExtendOptions) => MaybePromise<string | void>
  extendTools?: (options: ExtendOptions) => MaybePromise<Tool[] | void>
  init?: (agent: Agent) => MaybePromise<void>
  name: string
  onFinish?: (step?: CompletionStep) => MaybePromise<unknown>
  onStepFinish?: (step: CompletionStep) => MaybePromise<unknown>
  onTurnFinish?: (options: TurnFinishOptions) => MaybePromise<void>
  postToolCall?: PostToolCall
  prepareStep?: PrepareStep<AgentInput[], unknown>
  preToolCall?: PreToolCall
  stop?: () => MaybePromise<void>
  transformEntries?: (entries: readonly AgentEntry[], options: TransformEntriesOptions) => MaybePromise<readonly AgentEntry[]>
  version?: string
}

export type AgentPluginOption
  = | AgentPlugin
    | AgentPluginOption[]
    | false
    | null
    | undefined

export interface ExtendOptions {
  signal?: AbortSignal
  state: Readonly<AgentState>
  turnId: string
}

export interface TransformEntriesOptions extends ExtendOptions {}

export interface TurnFinishOptions {
  input: readonly AgentInput[]
  output: readonly AgentInput[]
  turnId: string
  usage?: Usage
}

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
      current = await hook(current, options) ?? current

    return current
  }
}
