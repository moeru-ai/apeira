import { describe, expect, it, vi } from 'vitest'

const mockHTML = `<!DOCTYPE html>
<html>
<head>
  <title>Test Article</title>
  <meta property="og:site_name" content="Test Site">
  <meta property="og:title" content="Test Article">
  <meta property="og:description" content="A test article">
</head>
<body>
  <nav>Navigation</nav>
  <header>Header</header>
  <aside>Sidebar</aside>
  <article>
    <h1>Test Article</h1>
    <p>This is the main content of the test article.</p>
    <p>It has multiple paragraphs of text.</p>
    <p>And some code: <code>console.log('hello')</code></p>
  </article>
  <footer>Footer</footer>
  <script>alert('xss')</script>
  <style>.danger { color: red; }</style>
</body>
</html>`

const mockHTMLWithoutArticle = `<!DOCTYPE html>
<html>
<head>
  <title>Simple Page</title>
</head>
<body>
  <h1>No Article Here</h1>
  <p>This page has no article element, just body text.</p>
  <p>Second paragraph.</p>
  <footer>Footer</footer>
</body>
</html>`

const mockHTMLWithDangerousContent = `<!DOCTYPE html>
<html>
<head>
  <title>Dangerous Page</title>
</head>
<body>
  <article>
    <h1>Page with dangerous HTML</h1>
    <script>alert('xss')</script>
    <p onclick="alert('click')">Click me</p>
    <img src="javascript:alert('xss')" alt="bad">
    <a href="javascript:alert('xss')">bad link</a>
    <iframe src="https://evil.com"></iframe>
  </article>
</body>
</html>`

const createMockResponse = (html: string, status = 200, contentType = 'text/html; charset=utf-8') => {
  const encoder = new TextEncoder()
  const body = encoder.encode(html)

  return new Response(body, {
    headers: {
      'content-length': String(body.byteLength),
      'content-type': contentType,
    },
    status,
    statusText: status === 200 ? 'OK' : 'Error',
  })
}

const mockFetchResponse = (response: Response) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)

describe('createFetchTool', () => {
  it('returns markdown content for a successful fetch with article', async () => {
    const spy = mockFetchResponse(createMockResponse(mockHTML))
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ url: 'https://example.com/article' })

    expect(result).toContain('# Test Article')
    expect(result).toContain('This is the main content of the test article')
    expect(result).toContain('console.log')
    expect(result).toContain('Fetched from https://example.com/article')
    expect(result).not.toContain('Navigation')
    expect(result).not.toContain('Footer')

    spy.mockRestore()
  })

  it('returns text content when format is text', async () => {
    const spy = mockFetchResponse(createMockResponse(mockHTML))
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ format: 'text', url: 'https://example.com/article' })

    expect(result).toContain('Test Article')
    expect(result).toContain('This is the main content of the test article')
    expect(result).not.toContain('**')
    expect(result).not.toContain('[')

    spy.mockRestore()
  })

  it('returns HTML content when format is html', async () => {
    const spy = mockFetchResponse(createMockResponse(mockHTML))
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ format: 'html', url: 'https://example.com/article' })

    expect(result).toContain('This is the main content of the test article')
    expect(result).toContain('<code>console.log')
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('<style>')
    expect(result).not.toContain('<nav>')
    expect(result).not.toContain('<footer>')

    spy.mockRestore()
  })

  it('strips dangerous HTML tags when format is html', async () => {
    const spy = mockFetchResponse(createMockResponse(mockHTMLWithDangerousContent))
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ format: 'html', url: 'https://example.com/dangerous' })

    expect(result).not.toContain('<script>')
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('javascript:')
    expect(result).not.toContain('<iframe>')

    spy.mockRestore()
  })

  it('falls back to text extraction when Readability returns nothing', async () => {
    const spy = mockFetchResponse(createMockResponse(mockHTMLWithoutArticle))
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ url: 'https://example.com/simple' })

    expect(result).toContain('No Article Here')
    expect(result).toContain('This page has no article element')
    expect(result).not.toContain('Navigation')
    expect(result).not.toContain('Footer')

    spy.mockRestore()
  })

  it('truncates content exceeding maxLength', async () => {
    const longContent = `<html><head><title>Long Page</title></head><body><article><p>${'a'.repeat(500)}</p></article></body></html>`
    const spy = mockFetchResponse(createMockResponse(longContent))
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ maxLength: 100, url: 'https://example.com/long' })

    expect(result).toContain('...[truncated')

    spy.mockRestore()
  })

  it('handles HTTP error responses gracefully', async () => {
    const spy = mockFetchResponse(
      new Response(null, { status: 404, statusText: 'Not Found' }),
    )
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ url: 'https://example.com/404' })

    expect(result).toContain('Error fetching')
    expect(result).toContain('HTTP 404')
    expect(result).toContain('Not Found')

    spy.mockRestore()
  })

  it('handles binary content type with error message', async () => {
    const spy = mockFetchResponse(
      new Response(null, {
        headers: { 'content-type': 'application/pdf' },
        status: 200,
        statusText: 'OK',
      }),
    )
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ url: 'https://example.com/doc.pdf' })

    expect(result).toContain('Error fetching')
    expect(result).toContain('binary')

    spy.mockRestore()
  })

  it('handles network errors gracefully', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'))
    const { createFetchTool } = await import('./fetch')

    const tool = createFetchTool()
    const result = await tool.execute({ url: 'https://example.com/unreachable' })

    expect(result).toContain('Error fetching')

    spy.mockRestore()
  })
})
