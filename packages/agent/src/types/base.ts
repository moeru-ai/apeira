import type { ResponsesOptions } from '@xsai-ext/responses'

export type AgentContext<T> = T & {
  contextLength?: number
  metadata?: Record<string, unknown>
}

export type Instructions<T> = ((context: AgentContext<T>) => Promise<string> | string) | string

export type ItemParam = Exclude<ResponsesOptions['input'], string>[number]

export type MaybePromise<T> = Promise<T> | T
