import type { MaybePromise } from './base'
import type { AgentInput } from './input'

export interface AgentStorage<T = AgentInput> {
  append: (...items: T[]) => MaybePromise<void>
  clear: () => MaybePromise<void>
  read: () => MaybePromise<Readonly<T[]>>
  reset: () => MaybePromise<void>
}
