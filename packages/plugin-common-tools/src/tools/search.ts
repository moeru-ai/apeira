import { rawTool } from '@apeira/core'
import { Readability } from '@mozilla/readability'

import { fetchAsBrowser } from '../utils/fetch-as-browser'

const DDG_LITE_URL = 'https://lite.duckduckgo.com/lite/'

const searchDDGLite = async (query: string, signal?: AbortSignal): Promise<string> => {
  const params = new URLSearchParams({ q: query })
  const { document } = await fetchAsBrowser(`${DDG_LITE_URL}?${params}`, signal)
  const reader = new Readability(document)
  const article = reader.parse()

  if (article?.textContent != null)
    return article.textContent

  for (const el of document.querySelectorAll('script, style'))
    el.remove()

  return (document.body?.textContent ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export const createSearchTool = () => rawTool({
  description: 'Search the web using DuckDuckGo. Returns search results with titles, URLs, and snippets. No API key required.',
  execute: async (input: unknown) => {
    const { maxResults, query } = input as { maxResults?: number, query: string }

    if (!query || query.trim().length === 0)
      throw new Error('Search query is required.')

    const content = await searchDDGLite(query.trim())
    const max = maxResults ?? 5
    const blocks = content.split(/\n{2,}/).filter(Boolean)
    const filtered = blocks.slice(0, max)

    return filtered.length > 0 ? filtered.join('\n\n') : 'No search results found.'
  },
  name: 'search',
  parameters: {
    properties: {
      maxResults: {
        description: 'Maximum number of search results to return (default: 5).',
        type: 'number',
      },
      query: { description: 'The search query.', type: 'string' },
    },
    required: ['query'],
    title: 'web_search_parameters',
    type: 'object',
  },
})
