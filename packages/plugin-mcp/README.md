# @apeira/plugin-mcp

Expose Model Context Protocol server tools to Apeira agents.

## Install

```sh
pnpm add @apeira/plugin-mcp
```

## Usage

### JS config

```ts
import { createAgent, responses } from '@apeira/core'
import { mcp } from '@apeira/plugin-mcp'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  plugins: [
    mcp({
      mcpServers: {
        docs: {
          headers: {
            Authorization: `Bearer ${process.env.DOCS_MCP_TOKEN}`,
          },
          timeout: 600_000,
          type: 'http',
          url: 'https://example.com/mcp',
        },
        filesystem: {
          args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
          command: 'npx',
        },
      },
    }),
  ],
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

### JSON config

```ts
import { createAgent, responses } from '@apeira/core'
import { mcp } from '@apeira/plugin-mcp'

import config from '../.mcp.json'

const agent = createAgent({
  instructions: 'You are a helpful assistant.',
  plugins: [
    mcp(config),
  ],
  runner: responses({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: 'https://api.openai.com/v1/',
    model: 'gpt-5.5',
  }),
})
```

To override imported JSON config in JavaScript, spread it into the same object:

```ts
mcp({
  ...config,
  progressiveToolDiscovery: true,
})
```

Example `.mcp.json`:

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

The plugin does not read `.mcp.json` from disk; pass an imported JSON object or an inline JavaScript object.

## API

### `mcp(config)`

Creates an Apeira plugin that converts MCP tools into `@xsai/tool` compatible function tools.

```ts
interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>
  progressiveToolDiscovery?: boolean
}
```

The config shape matches project-scoped `.mcp.json` files.

Supported server transports:

| Type | Use when |
|------|----------|
| `stdio` | Running a local MCP server process |
| `http` / `streamable-http` | Connecting to a Streamable HTTP MCP server |
| `sse` | Connecting to a legacy SSE MCP server |

Stdio servers may omit `type`; any server with `command` is treated as `stdio`.

Tool names are prefixed as `mcp_<serverId>__<toolName>` to avoid collisions with existing Apeira tools. Server and tool name parts are sanitized for function-tool compatibility.

### Progressive Tool Discovery

Set `progressiveToolDiscovery: true` to expose only three stable meta tools instead of every MCP tool schema upfront:

| Tool | Purpose |
|------|---------|
| `search_mcp_tools` | Search available MCP tools by query and return concise matches. |
| `get_mcp_tool_details` | Fetch the full schema for one matched MCP tool. |
| `call_mcp_tool` | Call one MCP tool by name with arguments matching its schema. |

This follows the catalog, inspect, execute pattern recommended by the MCP client best practices guide. The plugin still caches `tools/list` results host-side, but the model only sees full schemas for tools it asks to inspect. If some servers fail during catalog discovery, `search_mcp_tools` includes them in `serverFailures` while still returning tools from healthy servers.

### Environment Variables

The plugin expands environment variables in `command`, `args`, `env`, `url`, and `headers`.

- `${VAR}` expands to `process.env.VAR` and throws if it is missing.
- `${VAR:-default}` uses `default` when `process.env.VAR` is missing.

The `.mcp.json` `timeout` field is passed as the MCP request timeout for listing tools and calling tools.

### Lifecycle

Connections are lazy and persistent. The plugin connects to each server the first time tools are resolved, caches the listed tools by default, and reuses the MCP client for later tool calls.

### Errors

MCP tool results with `isError: true` are returned to the model as normal tool results. Tool-call transport, protocol, and timeout failures are converted into model-visible `isError` tool results. Tool discovery failures for one server do not prevent healthy servers from exposing their tools.
