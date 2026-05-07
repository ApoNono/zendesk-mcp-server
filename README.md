# Zendesk MCP Server

[![CI](https://github.com/ApoNono/zendesk-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/ApoNono/zendesk-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI assistants — Claude Desktop, Claude Code, Cursor, or any MCP-aware client — search your Zendesk Help Center articles and Support tickets without leaving the chat.

> Ask: *"Find KB articles about SSO setup"* or *"What's the latest comment on ticket 4827?"* and the assistant fetches it directly.

## Features

| Tool | What it does |
|------|--------------|
| `zd_article_search` | Search Help Center articles by keyword. Returns title, URL, snippet. |
| `zd_article_get` | Fetch a single article's full body by ID, with HTML stripped to plain text. |
| `zd_ticket_search` | Search tickets using Zendesk's [search query syntax](https://support.zendesk.com/hc/en-us/articles/4408886879258). Auto-scopes to `type:ticket`. |
| `zd_ticket_get` | Fetch a ticket by ID, optionally with the full comment thread. |

Built-in: token-bucket rate limiting per tool, exponential-backoff retries on 5xx and 429, structured logging via Pino, strict TypeScript.

## Quick start

### 1. Get a Zendesk API token

1. In Zendesk, go to **Admin Center → Apps and integrations → APIs → Zendesk API → Settings**.
2. Toggle **Token access** on.
3. Click **Add API token**, give it a label, copy the token. It's only shown once.

### 2. Install and build

```bash
git clone https://github.com/ApoNono/zendesk-mcp-server.git
cd zendesk-mcp-server
npm install
npm run build
```

### 3. Wire it up to your MCP client

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "zendesk": {
      "command": "node",
      "args": ["/absolute/path/to/zendesk-mcp-server/dist/index.js"],
      "env": {
        "ZENDESK_SUBDOMAIN": "your-subdomain",
        "ZENDESK_EMAIL": "you@example.com",
        "ZENDESK_API_TOKEN": "your_api_token_here"
      }
    }
  }
}
```

Fully quit Claude Desktop (`Cmd+Q`) and reopen. The four `zd_*` tools should appear under the tools menu.

#### Claude Code

```bash
claude mcp add zendesk -- node /absolute/path/to/zendesk-mcp-server/dist/index.js \
  -e ZENDESK_SUBDOMAIN=your-subdomain \
  -e ZENDESK_EMAIL=you@example.com \
  -e ZENDESK_API_TOKEN=your_token
```

#### Other MCP clients (Cursor, Continue, etc.)

This server speaks standard MCP over stdio. Any client that accepts a `command + args + env` config will work. See your client's docs for the exact config location.

## Configuration

| Env var | Required | Default | Notes |
|---------|----------|---------|-------|
| `ZENDESK_SUBDOMAIN` | yes | — | The part before `.zendesk.com` (e.g. `acme` for `acme.zendesk.com`). |
| `ZENDESK_EMAIL` | yes | — | Email of the Zendesk user the token belongs to. |
| `ZENDESK_API_TOKEN` | yes | — | API token from Admin Center. |
| `ZENDESK_API_TIMEOUT` | no | `10000` | HTTP timeout in ms. |
| `RATE_LIMIT_GLOBAL` | no | `100` | Max requests per window across all tools. |
| `RATE_LIMIT_WINDOW_MS` | no | `60000` | Rate-limit window in ms. |
| `LOG_LEVEL` | no | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal`. |
| `LOG_PRETTY` | no | `false` | Set `true` for human-readable colored logs (development only). |

## Example usage

Once connected, ask your assistant things like:

- *"Search the Zendesk knowledge base for articles about password resets."*
- *"Get the full text of KB article 360001234567."*
- *"Show me all open high-priority tickets assigned to me."*
- *"What's ticket 4827 about? Include the comment thread."*

The assistant decides which tool to call and with what arguments — you don't need to know the API.

## Authentication

This server uses Zendesk's **API token** flow: HTTP Basic auth where the username is `${email}/token` and the password is the API token, base64-encoded into the `Authorization` header. See the [Zendesk security and auth docs](https://developer.zendesk.com/api-reference/introduction/security-and-auth/).

OAuth2 is not yet supported. If you need per-user scoping or distribution as a multi-tenant integration, contributions adding an OAuth2 strategy are welcome.

## Rate limits

The server applies its own token-bucket rate limiting (default 100 req/min globally, 200 req/min for search tools). This sits *underneath* Zendesk's rate limits, which on standard plans are:

- **Search endpoint**: ~2,500 req/min
- **Tickets list**: 100 req/min on sandbox/trial
- Higher tiers available with the High Volume API Add-On

The server retries 429s with exponential backoff up to 3 attempts.

## Development

```bash
npm run dev          # tsx watch mode
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run lint:fix
npm test             # jest
npm run format       # prettier --write
```

CI runs typecheck, lint, test, and build on Node 18, 20, and 22 for every push and PR.

## Troubleshooting

**Tools don't appear in Claude Desktop**
Check `~/Library/Logs/Claude/mcp*.log` (macOS). Most common: incorrect path to `dist/index.js`, or Claude Desktop wasn't fully quit before reopening (`Cmd+Q`, not just close-window).

**`401 Unauthorized` on startup**
- Verify `ZENDESK_EMAIL` matches the user the API token was created for.
- Verify the subdomain. `https://${ZENDESK_SUBDOMAIN}.zendesk.com` should be your Zendesk URL.
- Try the credentials manually:
  ```bash
  curl -u "${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}" \
    "https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/users/me.json"
  ```

**`403 Forbidden` on ticket calls**
The user the token belongs to needs agent-level access. End-user tokens can't read all tickets.

**`429 Too Many Requests`**
The server retries with backoff, but if you hit this consistently, increase `RATE_LIMIT_WINDOW_MS` or upgrade your Zendesk plan.

## Architecture

```
src/
├── index.ts                — CLI entry point
├── core/                   — MCP server, tool registry, types
├── auth/manager.ts         — Zendesk basic auth (email/token → base64)
├── api/                    — axios client with retry + rate limiting
├── middleware/             — rate limiter, JSON schema validator
├── utils/                  — logger, config, errors, retry
└── tools/
    ├── articles/           — zd_article_search, zd_article_get
    └── tickets/            — zd_ticket_search, zd_ticket_get
```

Adding a new tool: extend `BaseTool`, define a JSON schema for parameters, implement `executeInternal`, register it in `src/core/server.ts`. See `src/tools/articles/get-article.ts` for a minimal example.

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow. The bar: typecheck, lint, and tests must pass.

## License

[MIT](LICENSE) © Tim P
