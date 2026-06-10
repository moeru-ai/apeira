# @apeira/plugin-common-tools

Common development tools (read, write, edit, bash, fetch, search) for Apeira agents.

## Install

```sh
pnpm add @apeira/plugin-common-tools
```

## Usage

```ts
import { createAgent, responses } from '@apeira/core'
import { commonTools } from '@apeira/plugin-common-tools'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
  plugins: [
    commonTools(),
  ],
})
```

## Tools

| Tool | Description |
|------|-------------|
| `read` | Read file contents with optional `offset` and `limit` for partial reads |
| `write` | Write or append to files, creating parent directories automatically |
| `edit` | Edit files via exact string replacement, with optional `replaceAll` |
| `bash` | Execute shell commands with configurable `timeout` and `workdir` |
| `fetch` | Fetch a URL and extract content as Markdown, text, or sanitized HTML using Mozilla Readability |
| `search` | Search the web via DuckDuckGo, no API key required |

### Tool details

**read** — reads text files. Supports `offset` (1-indexed line number) and `limit` for large files. Falls back to full read when neither is provided.

**write** — writes content to a file. The `append` option appends instead of overwriting. Parent directories are created automatically.

**edit** — finds `oldString` in the file and replaces it with `newString`. Set `replaceAll: true` to replace every occurrence instead of just the first. Throws if the old string is not found.

**bash** — executes a command via `child_process.exec`. Default timeout is 60 seconds. Use `workdir` to run in a specific directory.

**fetch** — fetches a URL with browser-like headers, parses with Mozilla Readability (the Firefox Reader View engine), and converts to clean Markdown via Turndown. Supports `format` parameter (`markdown`/`text`/`html`), `maxLength` truncation, 10MB body limit, binary content detection, and automatic charset detection.

**search** — searches the web via `lite.duckduckgo.com`. Returns titles, URLs, and snippets. No API key or registration required. Use `maxResults` to limit results.

## Selecting tools

Use `include` or `exclude` to control which tools are available (mutually exclusive):

```ts
commonTools({ include: ['read', 'write', 'bash'] })
commonTools({ exclude: ['fetch', 'search'] })
```
