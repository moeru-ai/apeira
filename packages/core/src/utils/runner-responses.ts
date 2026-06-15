import type { ResponsesOptions } from '@xsai-ext/responses'

import type { ItemParam } from '../types/base'
import type { AgentInput } from '../types/input'
import type { DynamicOptions, Runner } from '../types/runner'

import { stepCountAtLeast, responses as xsaiResponses } from '@xsai-ext/responses'

export type ResponsesRunnerOptions = Omit<ResponsesOptions, DynamicOptions>

export const toResponses = (inputs: readonly AgentInput[]): ItemParam[] =>
  inputs.flatMap((input): ItemParam[] => {
    if (input.type !== 'message' || input.role !== 'assistant')
      return [input]

    const message: ItemParam = {
      content: input.content,
      id: input.id,
      phase: input.phase,
      role: 'assistant',
      status: input.status,
      type: 'message',
    }

    return [
      message,
      ...(input.tool_calls?.map((toolCall): ItemParam => ({
        arguments: toolCall.function.arguments ?? '',
        call_id: toolCall.id,
        name: toolCall.function.name ?? '',
        type: 'function_call',
      })) ?? []),
    ]
  })

export const fromResponses = (inputs: ItemParam[]): AgentInput[] =>
  inputs

export const responses = (options: ResponsesRunnerOptions): Runner =>
  async (context) => {
    const input = toResponses(context.input)
    const result = xsaiResponses({
      ...options,
      abortSignal: context.abortSignal,
      input,
      instructions: context.instructions,
      onFinish: context.onFinish,
      onStepFinish: context.onStepFinish,
      postToolCall: context.postToolCall,
      prepareStep: context.prepareStep == null
        ? undefined
        : async (step) => {
          const prepared = await context.prepareStep!({
            ...step,
            input: fromResponses(step.input),
          })

          return {
            ...prepared,
            input: prepared.input == null ? undefined : toResponses(prepared.input),
          } as Awaited<ReturnType<NonNullable<ResponsesOptions['prepareStep']>>>
        },
      preToolCall: context.preToolCall,
      stopWhen: options.stopWhen ?? stepCountAtLeast(20),
      tools: [...(options.tools ?? []), ...context.tools],
    })

    for (const promise of [result.input, result.steps, result.usage, result.totalUsage])
      void promise.catch(() => undefined)

    for await (const event of result.eventStream)
      await context.channel.emit('apeira', { ...event, turnId: context.turnId })

    return {
      output: fromResponses((await result.input).slice(input.length)),
      usage: await result.totalUsage.catch(() => undefined),
    }
  }
