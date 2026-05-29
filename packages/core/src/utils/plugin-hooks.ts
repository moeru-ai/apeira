import type { ResponsesOptions } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { Episodic } from '../episodic'
import type { AgentContext, ItemParam } from '../types/base'
import type { AgentPlugin, ExtendInputOptions, ExtendInstructionsOptions, ResponseOptions } from '../types/plugin'

type PreparedStep = Awaited<ReturnType<PrepareStepHook>>
type PrepareStepHook = NonNullable<ResponsesOptions['prepareStep']>

const mergeTools = (tools: Tool[]): Tool[] =>
  [...new Map(tools.map(tool => [tool.function.name, tool])).values()]

const chainHooks = <H extends (...args: never[]) => unknown>(
  mode: 'all' | 'first',
  ...hooks: (H | undefined)[]
): H | undefined => {
  const list = hooks.filter(Boolean) as H[]
  if (list.length === 0)
    return undefined

  return (async (...args: Parameters<H>) => {
    for (const hook of list) {
      const result = await hook(...args)
      if (result != null && mode === 'first')
        return result
    }
    return undefined
  }) as H
}

const chainPrepareStepHooks = (
  ...hooks: (PrepareStepHook | undefined)[]
): ResponsesOptions['prepareStep'] => {
  const list = hooks.filter(Boolean) as PrepareStepHook[]
  if (list.length === 0)
    return undefined

  return async (stepOptions) => {
    let current = { ...stepOptions }
    let prepared: PreparedStep | undefined

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

export interface ResolvedResponseHooks {
  extendInput: ItemParam[]
  onFinish: ResponsesOptions['onFinish']
  onStepFinish: ResponsesOptions['onStepFinish']
  postToolCall: ResponsesOptions['postToolCall']
  prepareStep: ResponsesOptions['prepareStep']
  preToolCall: ResponsesOptions['preToolCall']
  tools: Tool[] | undefined
}

export interface ResolveResponseHooksOptions<T> {
  agentName: string
  context: AgentContext<T>
  episodic: Episodic
  input: ItemParam[]
  plugins: AgentPlugin<T>[]
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  sessionId: string
  signal: AbortSignal
  turnId: string
  turnInput: ItemParam
}

export const resolveResponseHooks = async <T>(
  options: ResolveResponseHooksOptions<T>,
): Promise<ResolvedResponseHooks> => {
  const hookBase = {
    agentName: options.agentName,
    context: options.context,
    sessionId: options.sessionId,
    signal: options.signal,
    turnId: options.turnId,
  }

  const responseOptions: ResponseOptions<T> = {
    ...hookBase,
    input: options.input,
    turnInput: options.turnInput,
  }

  const extendInputOptions: ExtendInputOptions<T> = {
    ...responseOptions,
    episodic: options.episodic,
  }

  const extensions: ItemParam[] = []
  for (const plugin of options.plugins) {
    if (plugin.extendInput == null)
      continue

    const extended = await plugin.extendInput(extendInputOptions)
    if (extended != null)
      extensions.push(...extended)
  }

  let tools = [...(options.responseOptions.tools ?? [])]
  for (const plugin of options.plugins) {
    if (plugin.extendTools == null)
      continue

    const extendedTools = await plugin.extendTools(responseOptions)
    if (extendedTools != null)
      tools = mergeTools([...tools, ...extendedTools])
  }

  return {
    extendInput: extensions,
    onFinish: chainHooks('all', options.responseOptions.onFinish, ...options.plugins.map(p => p.onFinish)),
    onStepFinish: chainHooks('all', options.responseOptions.onStepFinish, ...options.plugins.map(p => p.onStepFinish)),
    postToolCall: chainHooks('first', options.responseOptions.postToolCall, ...options.plugins.map(p => p.postToolCall)),
    prepareStep: chainPrepareStepHooks(options.responseOptions.prepareStep, ...options.plugins.map(p => p.prepareStep)),
    preToolCall: chainHooks('first', options.responseOptions.preToolCall, ...options.plugins.map(p => p.preToolCall)),
    tools: tools.length > 0 ? tools : options.responseOptions.tools,
  }
}

export interface ResolveInstructionsOptions<T> {
  agentName: string
  context: AgentContext<T>
  plugins: AgentPlugin<T>[]
  sessionId: string
  signal: AbortSignal
  turnId: string
  turnInput: ItemParam
}

export const resolveInstructions = async <T>(
  options: ResolveInstructionsOptions<T>,
  baseInstructions: string,
): Promise<string> => {
  const parts: string[] = [baseInstructions]

  for (const plugin of options.plugins) {
    if (plugin.extendInstructions == null)
      continue

    const result = await plugin.extendInstructions({
      agentName: options.agentName,
      context: options.context,
      sessionId: options.sessionId,
      signal: options.signal,
      turnId: options.turnId,
      turnInput: options.turnInput,
    } satisfies ExtendInstructionsOptions<T>)

    if (result != null && result.length > 0)
      parts.push(result)
  }

  return parts.filter(Boolean).join('\n\n')
}
