import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'
import type { Tool } from '@xsai/shared-chat'

import type { AgentContext } from '../types/context'
import type { ApeiraEvent } from '../types/event'
import type { ApeiraPlugin, ResolveToolsContext, ResponseContext, ThreadSaveContext, TurnStartContext } from '../types/plugin'
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

export type TurnCompletion
  = | { error: unknown, type: 'failed' }
    | { reason?: unknown, type: 'aborted' }
    | { type: 'done' }

export interface TurnOptions<T> {
  agentName: string
  emit: EmitTurnEvent
  getContext: (context?: Partial<AgentContext<T>>) => AgentContext<T>
  instructions: ((context: AgentContext<T>) => Promise<string> | string) | string
  plugins: ApeiraPlugin<T>[]
  ready: () => Promise<void>
  responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
  saveThread: (context: ThreadSaveContext<T>) => Promise<void> | void
  thread: ThreadStore
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

const createTurnStartContext = <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
): TurnStartContext<T> => ({
  agentName: options.agentName,
  context,
  input: options.turn.input,
  signal: options.controller.signal,
  threadId: options.threadId,
  turnId: options.turn.id,
})

const mergeTools = (tools: Tool[]): Tool[] => {
  const byName = new Map<string, Tool>()

  for (const tool of tools)
    byName.set(tool.function.name, tool)

  return [...byName.values()]
}

const resolveTools = async <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
) => {
  let tools = [...(options.responseOptions.tools ?? [])]

  for (const plugin of options.plugins) {
    if (plugin.resolveTools == null)
      continue

    const resolvedTools = await plugin.resolveTools({
      ...createTurnStartContext(options, context),
      tools,
    } satisfies ResolveToolsContext<T>)

    if (resolvedTools != null)
      tools = mergeTools([...tools, ...resolvedTools])
  }

  return tools.length > 0 ? tools : options.responseOptions.tools
}

const createOnFinish = <T>(
  options: RunTurnParams<T>,
  context: ResponseContext<T>,
): ResponsesOptions['onFinish'] => {
  const plugins = options.plugins.filter(plugin => plugin.onFinish != null)
  const original = options.responseOptions.onFinish

  if (original == null && plugins.length === 0)
    return undefined

  return async (step) => {
    await original?.(step)

    for (const plugin of plugins)
      await plugin.onFinish?.(step, context)
  }
}

const createOnStepFinish = <T>(
  options: RunTurnParams<T>,
  context: ResponseContext<T>,
): ResponsesOptions['onStepFinish'] => {
  const plugins = options.plugins.filter(plugin => plugin.onStepFinish != null)
  const original = options.responseOptions.onStepFinish

  if (original == null && plugins.length === 0)
    return undefined

  return async (step) => {
    await original?.(step)

    for (const plugin of plugins)
      await plugin.onStepFinish?.(step, context)
  }
}

const createPrepareStep = <T>(
  options: RunTurnParams<T>,
  context: ResponseContext<T>,
): ResponsesOptions['prepareStep'] => {
  const plugins = options.plugins.filter(plugin => plugin.prepareStep != null)
  const original = options.responseOptions.prepareStep

  if (original == null && plugins.length === 0)
    return undefined

  return async (stepOptions) => {
    let current = { ...stepOptions }
    let prepared: PreparedStep | undefined

    const applyResult = (result: PreparedStep | undefined | void) => {
      if (result == null)
        return

      prepared = { ...prepared, ...result }
      current = { ...current, ...result }
    }

    applyResult(await original?.(current))

    for (const plugin of plugins)
      applyResult(await plugin.prepareStep?.(current, context))

    return prepared ?? {}
  }
}

const runResponse = async <T>(
  options: RunTurnParams<T>,
  input: Array<QueuedInput<T> | QueuedTurn<T>>,
) => {
  const snapshot = options.thread.snapshot()
  const responseInput = [...snapshot.items, ...input.map(item => item.input)]
  const context = mergeRunContext(options.getContext(), input)
  const responseContext: ResponseContext<T> = {
    agentName: options.agentName,
    context,
    signal: options.controller.signal,
    threadId: options.threadId,
    turnId: options.turn.id,
  }
  const tools = await resolveTools(options, context)

  const result = responses({
    ...options.responseOptions,
    abortSignal: options.controller.signal,
    input: responseInput,
    instructions: typeof options.instructions === 'function'
      ? await options.instructions(context)
      : options.instructions,
    onFinish: createOnFinish(options, responseContext),
    onStepFinish: createOnStepFinish(options, responseContext),
    prepareStep: createPrepareStep(options, responseContext),
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

  if (options.thread.commit(snapshot.version, resolvedInput)) {
    await options.saveThread({
      agentName: options.agentName,
      context,
      snapshot: options.thread.snapshot(),
      threadId: options.threadId,
    })
  }
}

export const runTurn = async <T>(options: RunTurnParams<T>): Promise<TurnCompletion> => {
  try {
    await options.ready()

    const context = mergeRunContext(options.getContext(), [options.turn])

    for (const plugin of options.plugins)
      await plugin.onTurnStart?.(createTurnStartContext(options, context))

    options.emit(options.turn.id, { type: 'turn.start' })

    let nextInput: Array<QueuedInput<T> | QueuedTurn<T>> = [options.turn]

    while (true) {
      await runResponse(options, nextInput)

      if (options.controller.signal.aborted)
        throw options.controller.signal.reason

      const drained = options.drainInput()
      if (drained.length === 0)
        break

      options.emit(options.turn.id, { count: drained.length, type: 'turn.input_drained' })
      nextInput = drained
    }

    return { type: 'done' }
  }
  catch (error) {
    if (options.controller.signal.aborted)
      return { reason: options.controller.signal.reason, type: 'aborted' }

    return { error, type: 'failed' }
  }
}
