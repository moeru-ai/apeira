import type { Episode, ItemEpisode } from '@apeira/core/episodic'

export const isItemEpisode = (episode: Episode): episode is ItemEpisode =>
  episode.type === 'item' && episode.payload?.item != null
