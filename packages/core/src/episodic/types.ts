import type { Usage } from '@xsai-ext/responses'

import type { ItemParam } from '../types/base'

export interface BoundaryEpisode {
  id: number
  meta: EpisodeMeta
  payload: BoundaryPayload
  type: 'boundary'
}

export type BoundaryPayload
  = | { confidence?: number, reason: 'intent', title: string }
    | { content: string, reason: 'checkpoint', title: string }
    | { content?: string, reason: 'interrupt', title: string }
    | { content?: string, reason: 'overflow', title: string }
    | { content?: string, reason: 'segment', title: string }

export type BoundaryReason = 'checkpoint' | 'intent' | 'interrupt' | 'overflow' | 'segment'

export type Episode = BoundaryEpisode | ItemEpisode | MetaEpisode

export interface EpisodeMeta {
  source: 'agent' | 'model' | 'runtime' | 'tool' | 'user'
  turnId?: string
}

export interface Episodic {
  append: (event: NewEpisode) => Episode
  appendItems: (items: ItemParam[], meta?: Partial<EpisodeMeta>) => readonly Episode[]
  read: (query?: EpisodicQuery) => readonly Episode[]
  toJSONL: () => string
}

export interface EpisodicQuery {
  fromId?: number
  limit?: number
  turnId?: string
  type?: Episode['type'] | Episode['type'][]
}

export interface ItemEpisode {
  id: number
  meta: EpisodeMeta
  payload: { item: ItemParam }
  type: 'item'
}

export interface MetaEpisode {
  id: number
  meta: EpisodeMeta
  payload: MetaPayload
  type: 'meta'
}

export interface MetaPayload {
  data?: Record<string, unknown>
  event: string
  pluginId?: string
}

export type NewEpisode = Omit<Episode, 'id' | 'meta'> & {
  meta?: Partial<EpisodeMeta>
}

export type NormalizeFn = (items: ItemParam[]) => ItemParam[]

export type Slice = (episodic: Episodic, input: SliceOptions) => SliceResult

export interface SliceMeta {
  itemCount: number
  truncated: boolean
}

export interface SliceOptions {
  extensions?: ItemParam[]
  maxTokens?: number
  normalize?: NormalizeFn
  reserveOutputTokens?: number
  start?: SliceStart
  turnId?: string
}

export interface SliceResult {
  items: ItemParam[]
  meta: SliceMeta
}

export type SliceStart
  = | { reason?: BoundaryReason, type: 'last-boundary' }
    | { type: 'beginning' }

export interface TurnUsageData extends Record<string, unknown>, Usage {}
