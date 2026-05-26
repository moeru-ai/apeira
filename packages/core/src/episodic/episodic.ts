import type { ItemParam } from '../types/base'
import type { Episode, EpisodeMeta, Episodic, NewEpisode } from './types'

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
  if (!Number.isSafeInteger(episode.id))
    return undefined

  if (episode.type !== 'item' && episode.type !== 'boundary' && episode.type !== 'meta')
    return undefined

  if (typeof episode.payload !== 'object' || episode.payload == null)
    return undefined

  if (typeof episode.meta !== 'object' || episode.meta == null)
    return undefined

  return episode as Episode
}

const normalizeLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0

export const createEpisodic = (initial?: readonly Episode[] | string): Episodic => {
  let episodes: Episode[] = []
  let nextId = 1

  const appendParsed = (episode: Episode) => {
    const id = Math.max(episode.id, nextId)
    const imported = { ...episode, id }
    episodes.push(imported)
    nextId = id + 1
    return imported
  }

  const appendNew = (event: NewEpisode) => {
    const episode = {
      ...event,
      id: nextId,
      meta: defaultMeta(event.meta),
    } as Episode

    nextId += 1
    episodes.push(episode)
    return episode
  }

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const loadJSONL = (nextJSONL: string) => {
    episodes = []
    nextId = 1
    const errors: string[] = []
    let errorCount = 0
    let lineStart = 0

    while (true) {
      const nl = nextJSONL.indexOf('\n', lineStart)
      const lineEnd = nl === -1 ? nextJSONL.length : nl
      const line = nextJSONL.slice(lineStart, lineEnd).trim()
      lineStart = lineEnd + 1

      if (line.length > 0) {
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

      if (nl === -1)
        break
    }

    if (errorCount > 0) {
      appendNew({
        meta: { source: 'runtime' },
        payload: {
          data: { count: errorCount, errors },
          event: 'error.parse',
        },
        type: 'meta',
      })
    }
  }

  const api: Episodic = {
    append: appendNew,
    appendItems: (items: ItemParam[], meta?: Partial<EpisodeMeta>) =>
      items.map(item => api.append({
        meta,
        payload: { item },
        type: 'item',
      })),
    read: (query = {}) => {
      const kinds = Array.isArray(query.type)
        ? new Set(query.type)
        : query.type == null
          ? undefined
          : new Set([query.type])
      let result = episodes

      if (query.fromId != null)
        result = result.filter(episode => episode.id > query.fromId!)

      if (kinds != null)
        result = result.filter(episode => kinds.has(episode.type))

      if (query.turnId != null)
        result = result.filter(episode => episode.meta.turnId === query.turnId)

      if (typeof query.limit === 'number') {
        const limit = normalizeLimit(query.limit)
        result = limit === 0 ? [] : result.slice(-limit)
      }
      else if (
        query.fromId == null
        && query.type == null
        && query.turnId == null
      ) {
        result = result.slice(-DEFAULT_READ_LIMIT)
      }

      return [...result]
    },
    toJSONL: () => episodes.map(episode => JSON.stringify(episode)).join('\n'),
  }

  if (initial != null) {
    if (typeof initial === 'string') {
      loadJSONL(initial)
    }
    else {
      episodes = initial.map(e => ({ ...e }))
      nextId = episodes.reduce((max, episode) => Math.max(max, episode.id), 0) + 1
    }
  }

  return api
}
