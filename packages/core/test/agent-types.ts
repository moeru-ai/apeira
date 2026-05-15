import type { ResponsesOptions } from '@xsai-ext/responses'

import type { CreateAgentOptions, ItemParam } from '../src/index'

import { createAgent } from '../src/index'

declare const responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>
declare const input: ItemParam

export const noContextOptions: CreateAgentOptions = {
  instructions: 'test',
  name: 'test',
  options: responseOptions,
}

export const optionalContextOptions: CreateAgentOptions<{ value?: string }> = {
  instructions: 'test',
  name: 'test',
  options: responseOptions,
}

export const requiredContextOptions: CreateAgentOptions<{ value: string }> = {
  context: { value: 'test' },
  instructions: 'test',
  name: 'test',
  options: responseOptions,
}

// @ts-expect-error context is required when the agent context type has required fields.
export const missingRequiredContextOptions: CreateAgentOptions<{ value: string }> = {
  instructions: 'test',
  name: 'test',
  options: responseOptions,
}

export const agentContextTypeChecks = () => {
  const typedAgent = createAgent<{ locale: string, requestId?: string }>({
    context: { locale: 'en-US' },
    instructions: context => context.locale,
    name: 'typed',
    options: responseOptions,
  })

  typedAgent.setContext({ locale: 'zh-CN' })
  typedAgent.setContext({ requestId: 'req_123' })
  typedAgent.run(input, { context: { requestId: 'req_123' } })

  const typedThread = typedAgent.thread({
    context: { requestId: 'req_456' },
  })

  typedThread.setContext({ requestId: 'req_789' })
  typedThread.run(input, { context: { requestId: 'req_000' } })
}
