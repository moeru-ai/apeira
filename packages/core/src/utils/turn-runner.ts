import type { ResponsesOptions, Event as XSAIEvent } from '@xsai-ext/responses'
import type { Tool, ToolExecuteOptions } from '@xsai/shared-chat'

import type { AgentContext, Instructions } from '../types/context'
import type { ApeiraEvent } from '../types/event'
import type { AgentPlugin, ExtendInstructionsOptions, PluginPrivateStateApi, PostToolCallOptions, PreToolCallOptions, ResolveToolsOptions, ResponseOptions, SessionState, TurnStartOptions } from '../types/plugin'
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
  saveSession: (state: SessionState<T>) => Promise<void> | void
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
  mutateSession: (fn: () => Promise<void>) => Promise<void>
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

const createPluginPrivateState = <T>(
  session: SessionStore<T>,
  pluginName: string,
): PluginPrivateStateApi => ({
  clear: () => {
    session.setPluginState(pluginName, undefined)
  },
  get: <TState = unknown>() => session.getPluginState(pluginName) as TState | undefined,
  set: state => session.setPluginState(pluginName, state),
  update: <TState = unknown>(fn: (state: TState | undefined) => TState | undefined) => {
    const current = session.getPluginState(pluginName) as TState | undefined
    session.setPluginState(pluginName, fn(current))
  },
})

const createPluginHookBase = <T>(
  options: RunTurnParams<T>,
  context: AgentContext<T>,
  plugin?: AgentPlugin<T>,
) => ({
  agentName: options.agentName,
  context,
  ...(plugin == null ? {} : { privateState: createPluginPrivateState(options.session, plugin.name) }),
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
      agentName: options.agentName,
      context,
      input: options.turn.input,
      privateState: createPluginPrivateState(options.session, plugin.name),
      sessionId: options.sessionId,
      signal: options.controller.signal,
      turnId: options.turn.id,
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
  let tools = [...(options.responseOptions.tools ?? [])] as Tool[]

  for (const plugin of options.plugins) {
    if (plugin.resolveTools == null)
      continue

    const resolvedTools = await plugin.resolveTools({
      ...pluginOptions,
      privateState: createPluginPrivateState(options.session, plugin.name),
      tools,
    } satisfies ResolveToolsOptions<T>)

    if (resolvedTools != null)
      tools = mergeTools([...tools, ...resolvedTools])
  }

  return tools.length > 0 ? tools : options.responseOptions.tools
}

const createBlockedToolResult = (reason?: string, output?: unknown) =>
  output ?? {
    error: {
      code: 'TOOL_CALL_BLOCKED',
      message: reason ?? 'Tool call blocked.',
    },
    ok: false,
  }

const notifyPostToolCall = async <T>(
  options: RunTurnParams<T>,
  base: Omit<PostToolCallOptions<T>, 'privateState'>,
) => {
  for (const plugin of options.plugins) {
    if (plugin.postToolCall == null)
      continue

    await plugin.postToolCall({
      ...base,
      privateState: createPluginPrivateState(options.session, plugin.name),
    })
  }
}

const wrapTools = <T>(
  options: RunTurnParams<T>,
  tools: Tool[] | undefined,
  context: AgentContext<T>,
): Tool[] | undefined => {
  if (tools == null)
    return tools

  return tools.map(tool => ({
    ...tool,
    execute: async (input: unknown, executeOptions: ToolExecuteOptions) => {
      const base = {
        ...createPluginHookBase(options, context),
        input,
        tool,
        toolName: tool.function.name,
      } satisfies Omit<PreToolCallOptions<T>, 'privateState'>

      for (const plugin of options.plugins) {
        if (plugin.preToolCall == null)
          continue

        let result
        try {
          result = await plugin.preToolCall({
            ...base,
            privateState: createPluginPrivateState(options.session, plugin.name),
          })
        }
        catch (error) {
          result = {
            reason: error instanceof Error ? error.message : String(error),
            type: 'block' as const,
          }
        }

        if (result?.type === 'block') {
          const output = createBlockedToolResult(result.reason, result.output)
          await notifyPostToolCall(options, {
            ...base,
            output,
            status: 'blocked',
          })
          return output
        }
      }

      try {
        const output = await tool.execute(input, executeOptions)
        await notifyPostToolCall(options, {
          ...base,
          output,
          status: 'success',
        })
        return output
      }
      catch (error) {
        await notifyPostToolCall(options, {
          ...base,
          error,
          status: 'error',
        })
        throw error
      }
    },
  }))
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
): Promise<ResponseOptions<T>> => {
  const snapshot = options.session.snapshot()
  const responseInput = [...snapshot.items, ...input.map(item => item.input)]
  const context = mergeRunContext(options.getContext(), input)
  const responseOptions = createResponseOptions(options, context, responseInput)
  const tools = wrapTools(options, await resolveTools(options, responseOptions), context)

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

  await options.mutateSession(async () => {
    if (!options.session.commit(snapshot.version, resolvedInput))
      return

    await options.saveSession(options.session.snapshot())
  })

  return responseOptions
}

export const runTurn = async <T>(options: RunTurnParams<T>): Promise<TurnCompletion<T>> => {
  try {
    await options.ready()

    const context = mergeRunContext(options.getContext(), [options.turn])

    for (const plugin of options.plugins) {
      await plugin.onTurnStart?.({
        ...createTurnStartOptions(options, context),
        privateState: createPluginPrivateState(options.session, plugin.name),
      })
    }

    options.emit(options.turn.id, { type: 'turn.start' })

    const baseInstructions = typeof options.instructions === 'function'
      ? await options.instructions(context)
      : options.instructions

    const mergedInstructions = await resolveInstructions(options, context, baseInstructions)

    let nextInput: QueuedInput<T>[] = [options.turn]

    while (true) {
      const responseContext = await runResponse(options, nextInput, mergedInstructions)

      if (options.controller.signal.aborted)
        throw options.controller.signal.reason

      const drained = options.drainInput()
      if (drained.length === 0) {
        return { context: responseContext, type: 'done' }
      }

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
