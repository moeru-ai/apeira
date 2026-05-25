import type { Episode, EpisodeMeta, Episodic } from './types'
import type { ItemParam } from '../types/responses'

const DEFAULT_READ_LIMIT = 100
const MAX_PARSE_ERROR_SAMPLES = 5

const defaultMeta = (meta?: Partial<EpisodeMeta>): EpisodeMeta => ({
  source: meta?.source ?? 'runtime',
  turnId: meta?.turnId,
})

const parseEpisode = (value: unknown): Episode | undefined => {
  if (typeof value !== 'object' || value == null)
    return undefined

  const episode = value as Partial<Episode>
  if (typeof episode.id !== 'number')
    return undefined

  if (episode.kind !== 'item' && episode.kind !== 'boundary' && episode.kind !== 'meta')
    return undefined

  if (typeof episode.payload !== 'object' || episode.payload == null)
    return undefined

  if (typeof episode.meta !== 'object' || episode.meta == null)
    return undefined

  return episode as Episode
}

const normalizeLimit = (limit: number): number =>
  Math.max(0, Math.trunc(limit))

export const createEpisodic = (jsonl?: string): Episodic => {
  let episodes: Episode[] = []
  let nextId = 1

  const appendParsed = (episode: Episode) => {
    const id = Math.max(episode.id, nextId)
    const imported = { ...episode, id } as Episode
    episodes.push(imported)
    nextId = id + 1
    return imported
  }

  const api: Episodic = {
    append: (event) => {
      const episode = {
        ...event,
        id: nextId,
        meta: defaultMeta(event.meta),
      } as Episode

      nextId += 1
      episodes.push(episode)
      return episode
    },
    appendItems: (items: ItemParam[], meta?: Partial<EpisodeMeta>) =>
      items.map(item => api.append({
        kind: 'item',
        meta,
        payload: { item },
      })),
    fromJSONL: (nextJSONL) => {
      episodes = []
      nextId = 1
      const errors: string[] = []
      let errorCount = 0

      for (const line of nextJSONL.split('\n')) {
        if (line.trim().length === 0)
          continue

        try {
          const parsed = parseEpisode(JSON.parse(line))
          if (parsed == null)
            throw new Error('Invalid episode.')

          appendParsed(parsed)
        }
        catch (error) {
          errorCount += 1
          if (errors.length < MAX_PARSE_ERROR_SAMPLES)
            errors.push(error instanceof Error ? error.message : String(error))
        }
      }

      if (errorCount > 0) {
        api.append({
          kind: 'meta',
          payload: {
            data: { count: errorCount, errors },
            event: 'error.parse',
          },
          meta: { source: 'runtime' },
        })
      }
    },
    importEpisodes: nextEpisodes => nextEpisodes.map(appendParsed),
    read: (query = {}) => {
      const kinds = Array.isArray(query.kind)
        ? new Set(query.kind)
        : query.kind == null
          ? undefined
          : new Set([query.kind])
      let result = episodes

      if (query.afterBoundary != null) {
        const index = episodes.findLastIndex(episode =>
          episode.kind === 'boundary'
          && (query.afterBoundary === 'last' || episode.payload.reason === query.afterBoundary))

        result = index >= 0 ? episodes.slice(index + 1) : episodes
      }

      if (query.fromId != null)
        result = result.filter(episode => episode.id > query.fromId!)

      if (kinds != null)
        result = result.filter(episode => kinds.has(episode.kind))

      if (query.turnId != null)
        result = result.filter(episode => episode.meta.turnId === query.turnId)

      if (typeof query.limit === 'number') {
        const limit = normalizeLimit(query.limit)
        result = limit === 0 ? [] : result.slice(-limit)
      }
      else if (
        query.afterBoundary == null
        && query.fromId == null
        && query.kind == null
        && query.turnId == null
      )
        result = result.slice(-DEFAULT_READ_LIMIT)

      return [...result]
    },
    toJSONL: () => episodes.map(episode => JSON.stringify(episode)).join('\n'),
  }

  if (jsonl != null)
    api.fromJSONL(jsonl)

  return api
}
