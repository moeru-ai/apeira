import sanitizeHtml from 'sanitize-html'

import { Readability } from '@mozilla/readability'
import { rawTool } from '@xsai/tool'

import { fetchAsBrowser, FetchError } from '../utils/fetch-as-browser'
import { getTurndown } from '../utils/get-turndown'

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedAttributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'width', 'height'],
    td: ['colspan', 'rowspan'],
    th: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedTags: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'dd',
    'dl',
    'dt',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'img',
    'li',
    'ol',
    'p',
    'pre',
    's',
    'span',
    'strong',
    'sub',
    'sup',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
  ],
  disallowedTagsMode: 'discard',
}

const DEFAULT_MAX_LENGTH = 100_000
const TIMEOUT_MS = 30_000

const extractArticleContent = (
  article: ReturnType<typeof Readability.prototype.parse>,
  outputFormat: string,
) => {
  if (outputFormat === 'html') {
    return article?.content != null
      ? sanitizeHtml(String(article.content), SANITIZE_OPTIONS)
      : '<p>No readable content found.</p>'
  }

  if (article?.content != null)
    return getTurndown().turndown(String(article.content))

  return null
}

const extractTextContent = (document: Document) => {
  for (const el of document.querySelectorAll('script, style, nav, footer, header, aside'))
    el.remove()

  return (document.body?.textContent ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const buildMetadataBlock = (article: ReturnType<typeof Readability.prototype.parse>) => {
  const parts: string[] = []

  if (article?.title != null)
    parts.push(`# ${article.title}`)
  if (article?.byline != null)
    parts.push(`*By ${article.byline}*`)
  if (article?.siteName != null)
    parts.push(`*Source: ${article.siteName}*`)
  if (article?.publishedTime != null)
    parts.push(`*Published: ${article.publishedTime}*`)

  return parts
}

const buildResult = (content: string, url: string, bytes: number, durationMs: number, metadata: string[]) =>
  `${[...metadata, '', content || 'No readable content found.', '', `---\n*Fetched from ${url}*`].join('\n')}\n\n---\n*Fetched ${bytes} bytes in ${durationMs}ms*`

const buildErrorResult = (url: string, durationMs: number, error: FetchError) => {
  const errorParts = [`Error fetching ${url}`, `Reason: ${error.message}`]

  if (error.status != null)
    errorParts.push(`HTTP ${error.status}${error.statusText != null ? ` ${error.statusText}` : ''}`)

  errorParts.push('', `---\n*Fetched in ${durationMs}ms*`)

  return errorParts.join('\n')
}

const truncateContent = (content: string, max: number) => {
  if (content.length <= max)
    return content

  return `${content.slice(0, max)}\n\n...[truncated ${content.length - max} chars]`
}

export const createFetchTool = () => rawTool({
  description: 'Fetch a URL and extract its main content as clean Markdown. Uses Mozilla Readability to strip navigation, ads, and sidebars.',
  execute: async (input: unknown) => {
    const { format, maxLength, url } = input as { format?: string, maxLength?: number, url: string }
    const startTime = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const { bytes, document } = await fetchAsBrowser(url, controller.signal)
      const reader = new Readability(document)
      const article = reader.parse()

      const outputFormat = format ?? 'markdown'
      const content = outputFormat === 'text'
        ? extractTextContent(document)
        : extractArticleContent(article, outputFormat) ?? extractTextContent(document)

      const truncated = truncateContent(content, maxLength ?? DEFAULT_MAX_LENGTH)
      const metadata = buildMetadataBlock(article)
      const durationMs = Date.now() - startTime

      return buildResult(truncated, url, bytes, durationMs, metadata)
    }
    catch (error) {
      if (error instanceof FetchError) {
        const durationMs = Date.now() - startTime
        return buildErrorResult(url, durationMs, error)
      }

      throw error
    }
    finally {
      clearTimeout(timer)
    }
  },
  name: 'fetch',
  parameters: {
    properties: {
      format: {
        default: 'markdown',
        description: 'Output format: markdown (default), text (plain text), or html (sanitized HTML)',
        enum: ['html', 'markdown', 'text'],
        type: 'string',
      },
      maxLength: {
        default: 100_000,
        description: 'Maximum character length of the output content (default: 100,000)',
        type: 'number',
      },
      url: { description: 'The URL to fetch content from', type: 'string' },
    },
    required: ['url'],
    title: 'web_fetch_parameters',
    type: 'object',
  },
})
