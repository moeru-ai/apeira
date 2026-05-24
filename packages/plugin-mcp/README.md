# @apeira/plugin-mcp

Expose Model Context Protocol server tools to Apeira agents.

## Install

```sh
pnpm add @apeira/plugin-mcp
```

## Usage

```ts
import { createAgent } from '@apeira/core'
import { mcp } from '@apeira/plugin-mcp'

import config from '../.mcp.json'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  name: 'assistant',
  options: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  },
  plugins: [
    mcp(config),
  ],
})
```

## API

### `mcp(config)`

Creates an Apeira plugin that converts MCP tools into `@xsai/tool` compatible function tools.

```ts
interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
}
```

The config shape matches project-scoped `.mcp.json` files:

```json
{
  "mcpServers": {
    "docs": {
      "type": "http",
      "url": "https://example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${DOCS_MCP_TOKEN}"
      },
      "timeout": 600000
    },
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "env": {
        "NODE_ENV": "production"
      }
    }
  }
}
```

Supported server transports:

| Type | Use when |
|------|----------|
| `stdio` | Running a local MCP server process |
| `http` / `streamable-http` | Connecting to a Streamable HTTP MCP server |
| `sse` | Connecting to a legacy SSE MCP server |

Stdio servers may omit `type`; any server with `command` is treated as `stdio`.

Tool names are prefixed as `mcp_<serverId>__<toolName>` to avoid collisions with existing Apeira tools. Server and tool name parts are sanitized for function-tool compatibility.

### Environment Variables

The plugin expands environment variables in `command`, `args`, `env`, `url`, and `headers`.

- `${VAR}` expands to `process.env.VAR` and throws if it is missing.
- `${VAR:-default}` uses `default` when `process.env.VAR` is missing.

The `.mcp.json` `timeout` field is passed as the MCP request timeout for listing tools and calling tools.

### Lifecycle

Connections are lazy and persistent. The plugin connects to each server the first time tools are resolved, caches the listed tools by default, and reuses the MCP client for later tool calls.

### Errors

MCP tool results with `isError: true` are returned to the model as normal tool results. Transport, connection, protocol, and timeout failures throw by default.
