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
  // @ts-expect-error remove is only available on explicit sessions.
  void typedAgent.remove

  const typedSession = typedAgent.session({
    context: { requestId: 'req_456' },
  })

  void typedSession.remove()
  typedSession.setContext({ requestId: 'req_789' })
  typedSession.run(input, { context: { requestId: 'req_000' } })
}
