import { parseHTML } from 'linkedom'

export const BROWSER_HEADERS = {
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
  'Accept-Language': 'en-US,en;q=0.9',
  /** @see {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/User-Agent#chrome_ua_string} */
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
}

const MAX_BODY_BYTES = 10 * 1024 * 1024

const extractCharset = (contentType: string): string => {
  const match = /charset\s*=\s*([^\s;]+)/i.exec(contentType)
  return match?.[1] ?? 'utf-8'
}

export const isBinaryContentType = (contentType: string): boolean => {
  const lower = contentType.toLowerCase()

  if (lower.startsWith('text/'))
    return false

  if (lower.startsWith('application/')) {
    const subtype = lower.slice(12)

    return subtype !== 'json'
      && !subtype.endsWith('+json')
      && subtype !== 'xml'
      && !subtype.endsWith('+xml')
      && subtype !== 'javascript'
      && subtype !== 'ecmascript'
      && subtype !== 'x-www-form-urlencoded'
  }

  return lower.startsWith('audio/')
    || lower.startsWith('video/')
    || lower.startsWith('image/')
}

export interface FetchResult {
  bytes: number
  document: Document
  html: string
  url: string
}

export class FetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly statusText?: string,
  ) {
    super(message)
    this.name = 'FetchError'
  }
}

const fetchWithSizeLimit = async (
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ArrayBuffer> => {
  const contentLength = response.headers.get('content-length')

  if (contentLength != null && Number.parseInt(contentLength, 10) > maxBytes)
    throw new FetchError(`Response too large: ${contentLength} bytes exceeds ${maxBytes} byte limit`)

  if (!response.body)
    return response.arrayBuffer()

  const chunks: Uint8Array[] = []
  let total = 0
  const reader = response.body.getReader()

  try {
    while (true) {
      if (signal?.aborted)
        throw new FetchError('Request aborted')

      const { done, value } = await reader.read()

      if (done)
        break

      total += value.byteLength

      if (total > maxBytes) {
        void reader.cancel()
        throw new FetchError(`Response exceeded ${maxBytes} byte limit`)
      }

      chunks.push(value)
    }
  }
  finally {
    reader.releaseLock()
  }

  const combined = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }

  return combined.buffer
}

export const fetchAsBrowser = async (url: string, signal?: AbortSignal): Promise<FetchResult> => {
  let response: Response

  try {
    response = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        Referer: `${new URL(url).origin}/`,
      },
      redirect: 'follow',
      signal,
    })
  }
  catch (error) {
    if (error instanceof TypeError && error.message.includes('fetch'))
      throw new FetchError(`Network error: unable to reach ${url}`)

    throw error
  }

  if (!response.ok)
    throw new FetchError(`HTTP ${response.status}: ${response.statusText}`, response.status, response.statusText)

  const contentType = response.headers.get('content-type') ?? ''

  if (isBinaryContentType(contentType)) {
    const shortType = contentType.split(';')[0].trim()
    throw new FetchError(
      `Cannot fetch binary content (${shortType}). Only text-based content types are supported.`,
      415,
      'Unsupported Media Type',
    )
  }

  const buffer = await fetchWithSizeLimit(response, MAX_BODY_BYTES, signal)
  const charset = extractCharset(contentType)
  const decoder = new TextDecoder(charset)
  const html = decoder.decode(buffer)

  const { document } = parseHTML(html)

  return { bytes: buffer.byteLength, document, html, url: response.url }
}
