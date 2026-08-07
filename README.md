# Zendesk MCP Server

[![CI](https://github.com/ApoNono/zendesk-mcp-server/actions/workflows/ci.yml/badge.svg)](https://github.com/ApoNono/zendesk-mcp-server/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

A [Model Context Protocol](https://modelcontextprotocol.io) server for **product feedback intelligence and documentation-team enablement across the customer journey** — letting AI assistants (Claude Desktop, Claude Code, Cursor) read Zendesk, join it to other systems like [Productboard](https://github.com/miguelarios/productboard-mcp-server), and (since v0.4) apply approved content updates back to the Help Center.

> Ask: *"Find KB articles about SSO setup"*, *"What's the latest comment on ticket 4827?"*, or *"For the Q3 release notes in Jira, find the Zendesk articles that need updating and draft the changes in Confluence for review."*

Positioned for support managers, PMs hunting for product feedback signal in tickets, KB editors, and documentation teams doing multi-brand content maintenance.

## Tools

### Read-only

| Tool | What it does |
|------|--------------|
| `zd_article_search` | Search Help Center articles by keyword. Returns title, URL, snippet. |
| `zd_article_get` | Fetch a single article's full body by ID, with HTML stripped to plain text. |
| `zd_article_list_recent` | List articles updated within a date range (default last 7 days). Also supports `before` for stale-article audits. |
| `zd_articles_find_text` | Find articles containing plain-text across one or more brands. HTML-safe (skips URLs, code blocks). |
| `zd_ticket_search` | Search tickets using Zendesk's [search query syntax](https://support.zendesk.com/hc/en-us/articles/4408886879258). Auto-scopes to `type:ticket`. |
| `zd_ticket_get` | Fetch a ticket by ID. Side-loads requester + organization + flattens custom fields by default. |
| `zd_tickets_count_by` | Count tickets grouped by status / priority / type, with at least one filter applied. |
| `zd_organization_search` | Find organizations by name (autocomplete). Up to 25 matches. |
| `zd_organization_get` | Full details for an organization by ID, including domain names and custom fields. |
| `zd_user_search` | Find users by email or name. Refuses overly broad queries. |
| `zd_satisfaction_summary` | Pre-aggregated CSAT for a date range: % positive, count by score, top reasons. Defaults to last 30 days. |
| `zd_satisfaction_ratings_list` | Drill-down: individual ratings with comments and reasons. Requires at least one filter. |
| `zd_sections_list` | List Help Center categories and sections per brand. Use to find section IDs when moving articles. |

### Writes (v0.4+)

| Tool | What it does |
|------|--------------|
| `zd_article_create` | Create a new article in a specific brand's section. Defaults to draft=true for safety. Supports labels, permission_group_id, user_segment_id, author_id, and `create_reason` audit note. |
| `zd_article_update` | Update a single article's title, body, labels, section, or draft/promoted/outdated state. Only sends fields you explicitly pass. Supports `update_reason` audit note. |
| `zd_articles_replace_text` | Apply a plain-string find/replace to an explicit list of article IDs within one brand. HTML-safe. Regex not supported (use `scripts/replace-text-in-articles.ts` for regex). |

## Prompts

Prompts are pre-canned analytical workflows the LLM can invoke. They orchestrate multi-tool calls — sometimes across MCP servers — into a single user-facing command.

| Prompt | What it does | Cross-MCP dependency |
|--------|--------------|----------------------|
| `find_pb_insights_for_ticket` | Given a Zendesk ticket ID, finds related Productboard feedback from both the same customer and on the same topic. Surfaces gaps, suggests next actions. | Requires [productboard-mcp-server](https://github.com/miguelarios/productboard-mcp-server) connected. |
| `weekly_support_digest` | Manager-readable digest of the last N days (default 7): volume by status/priority, CSAT, recurring themes, hotspots. ~60-second read. | None. |

When a prompt requires another MCP server, it self-detects whether the peer is available and tells the user how to install it if not.

## Design principles

- **Narrow scope by default** — tools refuse overly broad queries and ask the user to refine, rather than truncating or churning through huge result sets.
- **Writes require explicit article IDs** — no bulk "find and update everything matching" operations. The user (or Claude) has to enumerate the target articles first (usually via `zd_articles_find_text`) and confirm the list before writes are applied. Ticket writes and article creation/deletion remain out of scope.
- **Cross-MCP composition** — prompts orchestrate this server with peers (Productboard, eventually others) rather than reimplementing their APIs.
- **Cross-brand aware** — configure multiple Zendesk brands via `ZENDESK_BRANDS`; the tools that need it (find, update, replace, sections) operate against any configured brand.

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

### Pair with Productboard MCP server (optional)

To use the cross-system prompts (e.g. `find_pb_insights_for_ticket`), also connect [productboard-mcp-server](https://github.com/miguelarios/productboard-mcp-server) in the same MCP client config. Both servers run side-by-side and the AI orchestrates across them.

Example combined Claude Desktop config:

```json
{
  "mcpServers": {
    "zendesk": {
      "command": "node",
      "args": ["/path/to/zendesk-mcp-server/dist/index.js"],
      "env": { "ZENDESK_SUBDOMAIN": "...", "ZENDESK_EMAIL": "...", "ZENDESK_API_TOKEN": "..." }
    },
    "productboard": {
      "command": "node",
      "args": ["/path/to/productboard-mcp-server/dist/index.js"],
      "env": { "PRODUCTBOARD_AUTH_TYPE": "bearer", "PRODUCTBOARD_API_TOKEN": "..." }
    }
  }
}
```

The cross-system prompts self-detect whether Productboard is available; if not, they tell you how to install it.

## Configuration

| Env var | Required | Default | Notes |
|---------|----------|---------|-------|
| `ZENDESK_SUBDOMAIN` | one of these | — | Single-brand setups. The part before `.zendesk.com` (e.g. `acme` for `acme.zendesk.com`). |
| `ZENDESK_BRANDS` | one of these | — | Multi-brand setups (v0.4+). Comma-separated subdomains, e.g. `help-admin,help-partners`. Primary brand is first in the list. Overrides `ZENDESK_SUBDOMAIN` when both are set. |
| `ZENDESK_EMAIL` | yes | — | Email of the Zendesk user the token belongs to. |
| `ZENDESK_API_TOKEN` | yes | — | API token from Admin Center. |
| `ZENDESK_API_TIMEOUT` | no | `10000` | HTTP timeout in ms. |
| `RATE_LIMIT_GLOBAL` | no | `100` | Max requests per window across all tools. |
| `RATE_LIMIT_WINDOW_MS` | no | `60000` | Rate-limit window in ms. |
| `LOG_LEVEL` | no | `info` | `trace` / `debug` / `info` / `warn` / `error` / `fatal`. |
| `LOG_PRETTY` | no | `false` | Set `true` for human-readable colored logs (development only). |

## Example usage

Once connected, ask your assistant things like:

**Knowledge base**
- *"Search the Zendesk knowledge base for articles about password resets."*
- *"Get the full text of KB article 360001234567."*

**Tickets with full context**
- *"Show me all open high-priority tickets assigned to me."*
- *"What's ticket 4827 about? Include the customer's organization and the comment thread."*
- *"Find all open tickets from ACME Corp."* (uses `zd_organization_search` then scoped ticket search)

**Customer-centric questions**
- *"Has bob@acme.com filed any other tickets recently?"*
- *"Tell me about the ACME Corp organization in Zendesk."*

**Analytics and reporting**
- *"Give me the weekly support digest."* (uses the `weekly_support_digest` prompt)
- *"What's our CSAT for the last 30 days?"*
- *"How many tickets did ACME Corp open this month, by status?"*
- *"Show me ratings with negative scores from the last week."*

**Cross-system feedback intelligence** (requires productboard-mcp-server)
- *"Use the find_pb_insights_for_ticket prompt for ticket 4827."*
- *"For ticket 4827, find any related Productboard feedback."*

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

CI runs typecheck, lint, test, and build on Node 20 and 22 for every push and PR.

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
├── core/                   — MCP server, tool + prompt registries, types
├── auth/manager.ts         — Zendesk basic auth (email/token → base64)
├── api/                    — axios client with retry + rate limiting
├── middleware/             — rate limiter, JSON schema validator
├── utils/                  — logger, config, errors, retry
├── tools/
│   ├── articles/           — zd_article_search, zd_article_get
│   ├── tickets/            — zd_ticket_search, zd_ticket_get, zd_tickets_count_by
│   ├── organizations/      — zd_organization_search, zd_organization_get
│   ├── users/              — zd_user_search
│   └── satisfaction/       — zd_satisfaction_summary, zd_satisfaction_ratings_list
└── prompts/                — analytical workflow templates
    ├── find-pb-insights.ts — cross-MCP feedback intelligence
    └── weekly-digest.ts    — manager-readable support digest
```

**Adding a new tool**: extend `BaseTool`, define a JSON schema for parameters, implement `executeInternal`, register it in `src/core/server.ts`. See `src/tools/articles/get-article.ts` for a minimal example.

**Adding a new prompt**: implement the `Prompt` interface, return `PromptMessage[]` from `render()`, register it in `src/core/server.ts`. For cross-MCP prompts, instruct the LLM in the prompt body to verify required peer tools (e.g. `pb_*`) are available before proceeding. See `src/prompts/find-pb-insights.ts` for the pattern.

## Contributing

PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow. The bar: typecheck, lint, and tests must pass.

## License

[MIT](LICENSE) © Tim P
