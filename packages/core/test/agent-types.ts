import type { ResponsesOptions } from '@xsai-ext/responses'

import type { CreateAgentOptions } from '../src/index'

declare const responseOptions: Omit<ResponsesOptions, 'abortSignal' | 'input' | 'instructions'>

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
