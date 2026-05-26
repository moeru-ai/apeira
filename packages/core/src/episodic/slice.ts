import type { ItemParam } from '../types/base'
import type { BoundaryEpisode, Episode, Episodic, MetaEpisode, SliceOptions, SliceResult, TurnUsageData } from './types'

import { normalizeItems } from './normalize'

const DEFAULT_MAX_TOKENS = Number.POSITIVE_INFINITY

const boundaryMessage = (episode: BoundaryEpisode): ItemParam | undefined => {
  const { payload } = episode

  if (payload.reason === 'intent' || payload.reason === 'segment')
    return undefined

  const content = payload.content ?? payload.title
  return {
    content: `<${payload.reason}>\n${content}\n</${payload.reason}>`,
    role: 'user',
    type: 'message',
  }
}

const isUsageMeta = (episode: Episode): episode is MetaEpisode =>
  episode.type === 'meta' && episode.payload.event === 'turn.usage'

const getUsage = (episode: MetaEpisode): TurnUsageData | undefined => {
  const data = episode.payload.data

  if (typeof data?.inputTokens !== 'number')
    return undefined

  if (typeof data.outputTokens !== 'number' || typeof data.totalTokens !== 'number')
    return undefined

  return data as TurnUsageData
}

const getStartEpisodes = (episodes: readonly Episode[], start: NonNullable<SliceOptions['start']>) => {
  if (start.type === 'beginning')
    return episodes

  const { reason } = start
  const index = episodes.findLastIndex(episode =>
    episode.type === 'boundary'
    && (reason == null || episode.payload.reason === reason))

  return index >= 0 ? episodes.slice(index) : episodes
}

const findOverflowStartIndex = (
  episodes: readonly Episode[],
  maxTokens: number,
  reserveOutputTokens = 0,
  turnId?: string,
) => {
  if (!Number.isFinite(maxTokens))
    return 0

  const budget = maxTokens - reserveOutputTokens
  if (budget <= 0)
    return episodes.length

  const latestUsage = episodes.findLast(isUsageMeta)
  const usage = latestUsage == null ? undefined : getUsage(latestUsage)
  if (usage == null || usage.inputTokens <= budget)
    return 0

  const boundaryIndex = episodes.findLastIndex(episode =>
    episode.type === 'boundary'
    && (episode.payload.reason === 'checkpoint' || episode.payload.reason === 'interrupt'))

  if (boundaryIndex >= 0)
    return boundaryIndex

  const turnIndex = turnId == null
    ? -1
    : episodes.findIndex(episode => episode.meta.turnId === turnId)

  return turnIndex >= 0 ? turnIndex : episodes.length
}

export const createSlice = (episodic: Episodic, options: SliceOptions = {}): SliceResult => {
  const {
    extensions = [],
    maxTokens = DEFAULT_MAX_TOKENS,
    normalize = normalizeItems,
    reserveOutputTokens,
    start = { type: 'beginning' },
    turnId,
  } = options
  const episodes = getStartEpisodes(episodic.read({ fromId: 0 }), start)
  const startIndex = findOverflowStartIndex(episodes, maxTokens, reserveOutputTokens, turnId)
  const selected = episodes.slice(startIndex)
  const items = selected.flatMap((episode): ItemParam[] => {
    if (episode.type === 'item')
      return [episode.payload.item]

    if (episode.type === 'boundary') {
      const item = boundaryMessage(episode)
      return item == null ? [] : [item]
    }

    return []
  })
  const normalized = normalize([...items, ...extensions])

  return {
    items: normalized,
    meta: {
      itemCount: normalized.length,
      truncated: startIndex > 0,
    },
  }
}
