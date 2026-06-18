import type { MaybePromise } from './base'
import type { AgentEntry } from './entry'

export interface AgentStorage<T = AgentEntry> {
  append: (...items: T[]) => MaybePromise<void>
  clear: () => MaybePromise<void>
  read: () => MaybePromise<Readonly<T[]>>
  reset: () => MaybePromise<void>
}
