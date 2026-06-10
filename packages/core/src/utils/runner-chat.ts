import type { StreamTextOptions } from '@xsai/stream-text'

import type { ChatRunnerOptions, Runner } from '../types/runner'

import { stepCountAtLeast } from '@xsai/shared-chat'
import { streamText } from '@xsai/stream-text'

import { fromChat, toChat } from './input'

export const chat = (options: ChatRunnerOptions): Runner =>
  async (context) => {
    const instructions = context.instructions === ''
      ? []
      : [{ content: context.instructions, role: 'system' as const }]
    const messages = [...instructions, ...toChat(context.input)]
    const result = streamText({
      ...options,
      abortSignal: context.abortSignal,
      messages,
      onFinish: context.onFinish,
      onStepFinish: context.onStepFinish,
      postToolCall: context.postToolCall,
      prepareStep: context.prepareStep == null
        ? undefined
        : async (step) => {
          const prepared = await context.prepareStep!({
            ...step,
            input: fromChat(step.input.slice(instructions.length)),
          })

          return {
            ...prepared,
            input: prepared.input == null
              ? undefined
              : [...instructions, ...toChat(prepared.input)],
          } as Awaited<ReturnType<NonNullable<StreamTextOptions['prepareStep']>>>
        },
      preToolCall: context.preToolCall,
      stopWhen: options.stopWhen ?? stepCountAtLeast(20),
      tools: [...(options.tools ?? []), ...context.tools],
    })

    for (const promise of [result.messages, result.steps, result.usage, result.totalUsage])
      void promise.catch(() => undefined)

    for await (const event of result.eventStream)
      context.channel.emit('apeira', { ...event, turnId: context.turnId })

    return {
      output: fromChat((await result.messages).slice(messages.length)),
      usage: await result.totalUsage.catch(() => undefined),
    }
  }
