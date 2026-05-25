import type { AssembleInput, BoundaryEpisode, Episode, Episodic, MetaEpisode, SliceConfig, SliceResult, TurnUsageData } from './types'
import type { ItemParam } from '../types/responses'

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
  episode.kind === 'meta' && episode.payload.event === 'turn.usage'

const getUsage = (episode: MetaEpisode): TurnUsageData | undefined => {
  const data = episode.payload.data

  if (typeof data?.inputTokens !== 'number')
    return undefined

  if (typeof data.outputTokens !== 'number' || typeof data.totalTokens !== 'number')
    return undefined

  return data as TurnUsageData
}

const getStartEpisodes = (episodes: Episode[], config: SliceConfig) => {
  if (config.start.type === 'beginning')
    return episodes

  const { reason } = config.start
  const index = episodes.findLastIndex(episode =>
    episode.kind === 'boundary'
    && (reason == null || episode.payload.reason === reason))

  return index >= 0 ? episodes.slice(index) : episodes
}

const findOverflowStartIndex = (episodes: Episode[], maxTokens: number, reserveOutputTokens = 0) => {
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
    episode.kind === 'boundary'
    && (episode.payload.reason === 'checkpoint' || episode.payload.reason === 'interrupt'))

  return boundaryIndex >= 0 ? boundaryIndex : 0
}

export const createSlice = () => (episodic: Episodic, input: AssembleInput): SliceResult => {
  const config: SliceConfig = {
    contributions: input.contributions,
    maxTokens: input.maxTokens ?? DEFAULT_MAX_TOKENS,
    normalize: input.normalize,
    reserveOutputTokens: input.reserveOutputTokens,
    start: input.start ?? { type: 'beginning' },
    turnId: input.turnId,
  }
  const episodes = getStartEpisodes(episodic.read({ fromId: 0 }), config)
  const startIndex = findOverflowStartIndex(episodes, config.maxTokens, config.reserveOutputTokens)
  const selected = episodes.slice(startIndex)
  const items = selected.flatMap((episode): ItemParam[] => {
    if (episode.kind === 'item')
      return [episode.payload.item]

    if (episode.kind === 'boundary') {
      const item = boundaryMessage(episode)
      return item == null ? [] : [item]
    }

    return []
  })
  const contributed = config.contributions?.flatMap(contribution => contribution.items) ?? []
  const normalize = config.normalize ?? normalizeItems
  const normalized = normalize([...items, ...contributed])

  return {
    items: normalized,
    meta: {
      injectedRefs: config.contributions?.map(contribution => ({
        pluginId: contribution.id,
        refId: contribution.id,
      })) ?? [],
      itemCount: normalized.length,
      truncated: startIndex > 0,
    },
  }
}
