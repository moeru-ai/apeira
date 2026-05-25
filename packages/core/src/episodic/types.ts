import type { Usage } from '@xsai-ext/responses'

import type { ItemParam } from '../types/responses'

export type BoundaryReason = 'checkpoint' | 'intent' | 'interrupt' | 'overflow' | 'segment'

export type Episode = BoundaryEpisode | ItemEpisode | MetaEpisode

export interface EpisodeMeta {
  source: 'agent' | 'model' | 'runtime' | 'tool' | 'user'
  turnId?: string
}

export interface ItemEpisode {
  id: number
  kind: 'item'
  meta: EpisodeMeta
  payload: { item: ItemParam }
}

export interface BoundaryEpisode {
  id: number
  kind: 'boundary'
  meta: EpisodeMeta
  payload: BoundaryPayload
}

export interface MetaEpisode {
  id: number
  kind: 'meta'
  meta: EpisodeMeta
  payload: MetaPayload
}

export type BoundaryPayload =
  | { content: string, reason: 'checkpoint', title: string }
  | { confidence?: number, reason: 'intent', title: string }
  | { content?: string, reason: 'interrupt', title: string }
  | { content?: string, reason: 'overflow', title: string }
  | { content?: string, reason: 'segment', title: string }

export interface MetaPayload {
  data?: Record<string, unknown>
  event: string
  pluginId?: string
}

export type NewEpisode = Omit<Episode, 'id' | 'meta'> & {
  meta?: Partial<EpisodeMeta>
}

export interface EpisodicQuery {
  afterBoundary?: BoundaryReason | 'last'
  fromId?: number
  kind?: Episode['kind'] | Episode['kind'][]
  limit?: number
  turnId?: string
}

export interface Episodic {
  append: (event: NewEpisode) => Episode
  appendItems: (items: ItemParam[], meta?: Partial<EpisodeMeta>) => Episode[]
  fromJSONL: (jsonl: string) => void
  importEpisodes: (episodes: Episode[]) => Episode[]
  read: (query?: EpisodicQuery) => Episode[]
  toJSONL: () => string
}

export interface SliceContribution {
  id: string
  items: ItemParam[]
}

export interface AssembleInput {
  context?: unknown
  contributions?: SliceContribution[]
  maxTokens?: number
  normalize?: NormalizeFn
  reserveOutputTokens?: number
  start?: SliceStart
  turnId?: string
}

export interface SliceConfig {
  contributions?: SliceContribution[]
  maxTokens: number
  normalize?: NormalizeFn
  reserveOutputTokens?: number
  start: SliceStart
  turnId?: string
}

export type SliceStart =
  | { type: 'beginning' }
  | { reason?: BoundaryReason, type: 'last-boundary' }

export interface SliceResult {
  items: ItemParam[]
  meta: SliceMeta
}

export interface SliceMeta {
  injectedRefs: Array<{ pluginId: string, refId: string }>
  itemCount: number
  truncated: boolean
}

export type NormalizeFn = (items: ItemParam[]) => ItemParam[]

export type Slice = (episodic: Episodic, input: AssembleInput) => SliceResult

export interface TurnUsageData extends Record<string, unknown>, Usage {}
