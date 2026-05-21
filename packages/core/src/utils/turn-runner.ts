import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { AgentContext } from '../types/context'
import type { ApeiraEvent } from '../types/event'
import type { AgentPlugin, ExtendInstructionsOptions, ResolveToolsOptions, ResponseOptions, ThreadState, TurnStartOptions } from '../types/plugin'
import type { ItemParam } from '../types/responses'
import type { ThreadStore } from './thread-store'

import { merge } from '@moeru/std/merge'
import { responses, stepCountAtLeast } from '@xsai-ext/responses'

export type EmitTurnEvent = (id: string, event: ApeiraEvent | XSAIEvent) => void

export interface QueuedInput<T> {
  context?: Partial<AgentContext<T>>
  input: ItemParam
  signal?: AbortSignal
}

export interface QueuedTurn<T = unknown> {
  context?: Partial<AgentContext<T>>
  id: string
  input: ItemParam
  signal?: AbortSignal
}

export interface RunTurnOptions<T> {
  controller: AbortController
  drainInput: () => QueuedInput<T>[]
  turn: QueuedTurn<T>
}

export type RunTurnParams<T> = RunTurnOptions<T> & TurnOptions<T>

export type TurnCompletion<T = unknown>
  = | { context: ResponseOptions<T>, type: 'done' }
    | { error: unknown, type: 'failed' }
    | { reason?: unknown, type: 'aborted' }

export interface TurnOptions<T> {
  agentName: string
  emit: EmitTurnEvent
  getContext: (context?: Partial<AgentContext<T>>) => AgentContext<T>
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  mutateThread: (fn: () => Promise<void>) => Promise<void>
  plugins: AgentPlugin<T>[]
  ready: () => Promise<void>
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  saveThread: (state: ThreadState<T>) => Promise<void> | void
  thread: ThreadStore<T>
  threadId: string
}

type PreparedStep = Awaited<ReturnType<PrepareStepHook>>

type PrepareStepHook = NonNullable<ResponsesOptions['prepareStep']>

const mergeRunContext = <T>(
  context: AgentContext<T>,
  input: Array<QueuedInput<T> | QueuedTurn<T>>,
): AgentContext<T> =>
  input.reduce<AgentContext<T>>(
    (current, item) => merge(current, item.context),
    context,
  )

const createTurnStartOptions = <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
): TurnStartOptions<T> => ({
  agentName: options.agentName,
  context,
  input: options.turn.input,
  signal: options.controller.signal,
  threadId: options.threadId,
  turnId: options.turn.id,
})

const createResponseOptions = <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
  input: ItemParam[],
): ResponseOptions<T> => ({
  agentName: options.agentName,
  context,
  input,
  signal: options.controller.signal,
  threadId: options.threadId,
  turnId: options.turn.id,
  turnInput: options.turn.input,
})

const mergeTools = (tools: Tool[]): Tool[] => {
  const byName = new Map<string, Tool>()

  for (const tool of tools)
    byName.set(tool.function.name, tool)

  return [...byName.values()]
}

const resolveInstructions = async <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
): Promise<string[]> => {
  const parts: string[] = []

  for (const plugin of options.plugins) {
    if (plugin.extendInstructions == null)
      continue

    const result = await plugin.extendInstructions({
      agentName: options.agentName,
      context,
      input: options.turn.input,
      signal: options.controller.signal,
      threadId: options.threadId,
      turnId: options.turn.id,
    } satisfies ExtendInstructionsOptions<T>)

    if (result != null && result.length > 0)
      parts.push(result)
  }

  return parts
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

const createOnFinish = <T>(options: RunTurnParams<T>): ResponsesOptions['onFinish'] => {
  const hooks = [
    options.responseOptions.onFinish,
    ...options.plugins.map(plugin => plugin.onFinish),
  ].filter((hook): hook is NonNullable<ResponsesOptions['onFinish']> => hook != null)

  if (hooks.length === 0)
    return undefined

  return async (step) => {
    for (const hook of hooks)
      await hook(step)
  }
}

const createOnStepFinish = <T>(options: RunTurnParams<T>): ResponsesOptions['onStepFinish'] => {
  const hooks = [
    options.responseOptions.onStepFinish,
    ...options.plugins.map(plugin => plugin.onStepFinish),
  ].filter((hook): hook is NonNullable<ResponsesOptions['onStepFinish']> => hook != null)

  if (hooks.length === 0)
    return undefined

  return async (step) => {
    for (const hook of hooks)
      await hook(step)
  }
}

const createPrepareStep = <T>(options: RunTurnParams<T>): ResponsesOptions['prepareStep'] => {
  const hooks = [
    options.responseOptions.prepareStep,
    ...options.plugins.map(plugin => plugin.prepareStep),
  ].filter((hook): hook is PrepareStepHook => hook != null)

  if (hooks.length === 0)
    return undefined

  return async (stepOptions) => {
    let current = { ...stepOptions }
    let prepared: PreparedStep | undefined

    for (const hook of hooks) {
      const result = await hook(current)

      if (result != null) {
        prepared = { ...prepared, ...result }
        current = { ...current, ...result }
      }
    }

    return prepared ?? {}
  }
}

const runResponse = async <T>(
  options: RunTurnParams<T>,
  input: Array<QueuedInput<T> | QueuedTurn<T>>,
  instructions: string,
): Promise<ResponseOptions<T>> => {
  const snapshot = options.thread.snapshot()
  const responseInput = [...snapshot.items, ...input.map(item => item.input)]
  const context = mergeRunContext(options.getContext(), input)
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

  void result.input.catch(() => undefined)
  void result.steps.catch(() => undefined)
  void result.usage.catch(() => undefined)
  void result.totalUsage.catch(() => undefined)

  for await (const event of result.eventStream)
    options.emit(options.turn.id, event)

  const resolvedInput = await result.input

  await options.mutateThread(async () => {
    if (!options.thread.commit(snapshot.version, resolvedInput))
      return

    await options.saveThread(options.thread.snapshot())
  })

  return responseOptions
}

export const runTurn = async <T>(options: RunTurnParams<T>): Promise<TurnCompletion<T>> => {
  try {
    await options.ready()

    const context = mergeRunContext(options.getContext(), [options.turn])

    for (const plugin of options.plugins)
      await plugin.onTurnStart?.(createTurnStartOptions(options, context))

    options.emit(options.turn.id, { type: 'turn.start' })

    const baseInstructions = typeof options.instructions === 'function'
      ? await options.instructions(context)
      : options.instructions

    const extendedParts = await resolveInstructions(options, context)
    const mergedInstructions = extendedParts.length > 0
      ? [baseInstructions, ...extendedParts].join('\n\n')
      : baseInstructions

    let nextInput: Array<QueuedInput<T> | QueuedTurn<T>> = [options.turn]

    while (true) {
      const responseContext = await runResponse(options, nextInput, mergedInstructions)

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
