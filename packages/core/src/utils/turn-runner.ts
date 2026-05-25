import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { SliceContribution } from '../episodic'
import type { AgentContext, Instructions } from '../types/context'
import type { ApeiraEvent } from '../types/event'
import type { AgentPlugin, ExtendInstructionsOptions, ResolveToolsOptions, ResponseOptions, TurnStartOptions } from '../types/plugin'
import type { ItemParam } from '../types/responses'
import type { SessionStore } from './session-store'

import { merge } from '@moeru/std/merge'
import { responses, stepCountAtLeast } from '@xsai-ext/responses'

export interface AgentCoreOptions<T> {
  agentName: string
  emit: EmitTurnEvent
  getContext: (context?: Partial<AgentContext<T>>) => AgentContext<T>
  instructions: Instructions<T>
  plugins: AgentPlugin<T>[]
  ready: () => Promise<void>
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  sessionId: string
}

export type EmitTurnEvent = (id: string, event: ApeiraEvent | XSAIEvent) => void

export interface QueuedInput<T> {
  context?: Partial<AgentContext<T>>
  id?: string
  input: ItemParam
  signal?: AbortSignal
}

export interface RunTurnOptions<T> {
  controller: AbortController
  drainInput: () => QueuedInput<T>[]
  turn: QueuedInput<T> & { id: string }
}

export type RunTurnParams<T> = RunTurnOptions<T> & TurnOptions<T>

export type TurnCompletion<T = unknown>
  = | { context: ResponseOptions<T>, type: 'done' }
    | { error: unknown, type: 'failed' }
    | { reason?: unknown, type: 'aborted' }

export interface TurnOptions<T> extends AgentCoreOptions<T> {
  session: SessionStore<T>
}

type PreparedStep = Awaited<ReturnType<PrepareStepHook>>

type PrepareStepHook = NonNullable<ResponsesOptions['prepareStep']>

const mergeRunContext = <T>(
  context: AgentContext<T>,
  input: QueuedInput<T>[],
): AgentContext<T> =>
  input.reduce<AgentContext<T>>(
    (current, item) => merge(current, item.context),
    context,
  )

const createPluginHookBase = <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
) => ({
  agentName: options.agentName,
  context,
  episodic: options.session.episodic,
  sessionId: options.sessionId,
  signal: options.controller.signal,
  turnId: options.turn.id,
})

const createTurnStartOptions = <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
): TurnStartOptions<T> => ({
  ...createPluginHookBase(options, context),
  input: options.turn.input,
})

const createResponseOptions = <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
  input: ItemParam[],
): ResponseOptions<T> => ({
  ...createPluginHookBase(options, context),
  input,
  turnInput: options.turn.input,
})

const mergeTools = (tools: Tool[]): Tool[] =>
  [...new Map(tools.map(tool => [tool.function.name, tool])).values()]

const resolveInstructions = async <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
  base: string,
): Promise<string> => {
  const parts: string[] = [base]

  for (const plugin of options.plugins) {
    if (plugin.extendInstructions == null)
      continue

    const result = await plugin.extendInstructions({
      ...createPluginHookBase(options, context),
      input: options.turn.input,
    } satisfies ExtendInstructionsOptions<T>)

    if (result != null && result.length > 0)
      parts.push(result)
  }

  return parts.join('\n\n')
}

const resolveTools = async <T>(
  options: RunTurnParams<T>,
  pluginOptions: ResponseOptions<T>,
) => {
  let tools = [...(options.responseOptions.tools ?? [])]

  for (const plugin of options.plugins) {
    if (plugin.resolveTools == null)
      continue

    const resolvedTools = await plugin.resolveTools({ ...pluginOptions, tools } satisfies ResolveToolsOptions<T>)

    if (resolvedTools != null)
      tools = mergeTools([...tools, ...resolvedTools])
  }

  return tools.length > 0 ? tools : options.responseOptions.tools
}

const chainStepHooks = <H extends (step: never) => unknown>(
  ...hooks: (H | undefined)[]
): H | undefined => {
  const list = hooks.filter(Boolean) as H[]
  if (list.length === 0)
    return undefined

  return (async (step: Parameters<H>[0]) => {
    for (const hook of list)
      await hook(step)
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

const createOnFinish = <T>(options: RunTurnParams<T>): ResponsesOptions['onFinish'] =>
  chainStepHooks(options.responseOptions.onFinish, ...options.plugins.map(plugin => plugin.onFinish))

const createOnStepFinish = <T>(options: RunTurnParams<T>): ResponsesOptions['onStepFinish'] =>
  chainStepHooks(options.responseOptions.onStepFinish, ...options.plugins.map(plugin => plugin.onStepFinish))

const createPrepareStep = <T>(options: RunTurnParams<T>): ResponsesOptions['prepareStep'] =>
  chainPrepareStepHooks(
    options.responseOptions.prepareStep,
    ...options.plugins.map(plugin => plugin.prepareStep),
  )

const runResponse = async <T>(
  options: RunTurnParams<T>,
  input: QueuedInput<T>[],
  instructions: string,
  contributions: SliceContribution[],
): Promise<ResponseOptions<T>> => {
  const context = mergeRunContext(options.getContext(), input)
  options.session.episodic.appendItems(input.map(item => item.input), {
    source: 'user',
    turnId: options.turn.id,
  })
  const assembled = options.session.assemble({
    context,
    contributions,
    reserveOutputTokens: typeof options.responseOptions.maxOutputTokens === 'number'
      ? options.responseOptions.maxOutputTokens
      : undefined,
    turnId: options.turn.id,
  })
  const responseInput = assembled.items
  const responseOptions = createResponseOptions(options, context, responseInput)
  const tools = await resolveTools(options, responseOptions)

  const result = responses({
    ...options.responseOptions,
    abortSignal: options.controller.signal,
    input: responseInput,
    instructions,
    onFinish: createOnFinish(options),
    onStepFinish: createOnStepFinish(options),
    prepareStep: createPrepareStep(options),
    stopWhen: options.responseOptions.stopWhen ?? stepCountAtLeast(20),
    tools,
  })

  for (const p of [result.input, result.steps, result.usage, result.totalUsage] as const)
    void p.catch(() => undefined)

  for await (const event of result.eventStream)
    options.emit(options.turn.id, event)

  const resolvedInput = await result.input
  const totalUsage = await result.totalUsage
  const usage = totalUsage ?? await result.usage
  const newItems = resolvedInput.slice(responseInput.length)

  options.session.episodic.appendItems(newItems, {
    source: 'model',
    turnId: options.turn.id,
  })

  if (usage != null) {
    options.session.episodic.append({
      kind: 'meta',
      meta: { source: 'runtime', turnId: options.turn.id },
      payload: {
        data: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
        },
        event: 'turn.usage',
      },
    })
  }

  return responseOptions
}

export const runTurn = async <T>(options: RunTurnParams<T>): Promise<TurnCompletion<T>> => {
  try {
    await options.ready()

    const context = mergeRunContext(options.getContext(), [options.turn])
    const contributions: SliceContribution[] = []

    for (const plugin of options.plugins) {
      const result = await plugin.onTurnStart?.(createTurnStartOptions(options, context))

      if (result?.contributions != null)
        contributions.push(...result.contributions)
    }

    options.emit(options.turn.id, { type: 'turn.start' })

    const baseInstructions = typeof options.instructions === 'function'
      ? await options.instructions(context)
      : options.instructions

    const mergedInstructions = await resolveInstructions(options, context, baseInstructions)

    let nextInput: QueuedInput<T>[] = [options.turn]

    while (true) {
      const responseContext = await runResponse(options, nextInput, mergedInstructions, contributions)

      if (options.controller.signal.aborted)
        throw options.controller.signal.reason

      const drained = options.drainInput()
      if (drained.length === 0)
        return { context: responseContext, type: 'done' }

      options.emit(options.turn.id, { count: drained.length, type: 'turn.input_drained' })
      nextInput = drained
    }
  }
  catch (error) {
    if (options.controller.signal.aborted)
      return { reason: options.controller.signal.reason, type: 'aborted' }

    return { error, type: 'failed' }
  }
}
