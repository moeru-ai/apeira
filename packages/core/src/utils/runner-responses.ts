import type { ResponsesOptions } from '@xsai-ext/responses'

import type { ResponsesRunnerOptions, Runner } from '../types/runner'

import { stepCountAtLeast, responses as xsaiResponses } from '@xsai-ext/responses'

import { fromResponses, toResponses } from './input'

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
      context.channel.emit('apeira', { ...event, turnId: context.turnId })

    return {
      output: fromResponses((await result.input).slice(input.length)),
      usage: await result.totalUsage.catch(() => undefined),
    }
  }
