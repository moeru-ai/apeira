import type {
  AgentEntry,
  AgentEvent,
  AgentInput,
  AgentState,
  AgentStorage,
} from '@apeira/core'

export interface SessionCheckoutEntryData {
  target:
    | { id: string, type: 'id' }
    | { name: string, type: 'ref' }
    | { type: 'empty' }
}

export interface SessionRefEntryData {
  name: string
  targetId?: string
}

declare module '@apeira/core' {
  interface AgentCustomEntry {
    'session/checkout': SessionCheckoutEntryData
    'session/ref': SessionRefEntryData
  }
}

export interface CloneOptions {
  checkout?: EntryId | RefName
  from?: EntryId | RefName
  refs?: 'active' | 'all' | readonly RefName[]
  sessionStorage: AgentStorage<AgentEntry>
}
export interface CreateSessionOptions {
  defaultRef?: RefName
  id?: () => string
  now?: () => number
  sessionStorage: AgentStorage<AgentEntry>
}

// eslint-disable-next-line sonarjs/redundant-type-aliases
export type EntryId = string

export interface EventOptions {
  parentId?: EntryId
}

export interface ForkOptions {
  checkout?: boolean
  from?: EntryId | RefName
}

export type Head
  = | { name: RefName, type: 'ref' }
    | { targetId?: EntryId, type: 'detached' }

export interface RebaseResult {
  entries: readonly { newId: EntryId, oldId: EntryId }[]
  name: RefName
  newBaseId?: EntryId
  newHeadId?: EntryId
  oldBaseId?: EntryId
  oldHeadId?: EntryId
}

// eslint-disable-next-line sonarjs/redundant-type-aliases
export type RefName = string

export interface Session {
  buildInput: (target?: EntryId | RefName) => Promise<readonly AgentInput[]>
  buildState: (target?: EntryId | RefName) => Promise<Readonly<AgentState>>

  checkout: (target?: EntryId | RefName) => Promise<void>
  clone: (options: CloneOptions) => Promise<Session>
  event: (event: AgentEvent, options?: EventOptions) => Promise<AgentEntry>
  fork: (name: RefName, options?: ForkOptions) => Promise<void>
  head: () => Promise<Head>
  path: (target?: EntryId | RefName) => Promise<readonly AgentEntry[]>

  read: () => Promise<SessionSnapshot>
  rebase: (name: RefName, onto?: EntryId | RefName) => Promise<RebaseResult>
  refs: () => Promise<ReadonlyMap<RefName, EntryId | undefined>>
  readonly sessionStorage: AgentStorage<AgentEntry>

  readonly storage: AgentStorage<AgentEntry>
}

export type SessionErrorCode
  = | 'busy'
    | 'invalid_rebase'
    | 'invalid_ref'
    | 'not_found'
    | 'storage'
    | 'unknown'

export interface SessionMetadata {
  createdAt: string
  id: string
  updatedAt: string
}

export interface SessionRepository {
  create: (options?: { cwd?: string, id?: string }) => Promise<Session>
  delete: (id: string) => Promise<void>
  list: (options?: { cwd?: string }) => Promise<readonly SessionMetadata[]>
  open: (id: string) => Promise<Session>
}

export interface SessionSnapshot {
  entries: readonly AgentEntry[]
  entryById: ReadonlyMap<EntryId, AgentEntry>
  head: Head
  headTargetId?: EntryId
  refs: ReadonlyMap<RefName, EntryId | undefined>
}

export class SessionError extends Error {
  readonly code: SessionErrorCode

  constructor(code: SessionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = 'SessionError'
  }
}
