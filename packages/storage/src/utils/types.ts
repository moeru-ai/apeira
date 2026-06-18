import type { AgentEntry } from '@apeira/core'

export interface FileStorageOptions<T = AgentEntry> {
  initial?: readonly T[]
  /** Path to the file. */
  path: string
}
