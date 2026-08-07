# Scripts

One-off operational scripts that **do write to Zendesk**. The MCP server itself is read-only; these scripts are kept separate to make the boundary explicit.

## `replace-text-in-articles.ts`

Find and replace text across Help Center articles, scoped to one or more brands. HTML-safe: walks text nodes only, never touching URLs, CSS classes, or code blocks.

### Usage

```bash
# Dry-run (default) — shows what would change without writing anything
npx tsx scripts/replace-text-in-articles.ts

# Actually apply the changes
npx tsx scripts/replace-text-in-articles.ts --apply
```

Reads `ZENDESK_SUBDOMAIN`, `ZENDESK_EMAIL`, `ZENDESK_API_TOKEN` from `.env`.

### Configuration

Edit the top of the file:

- `BRAND_IDS` — set of Zendesk brand IDs to scope to. Articles outside these brands are skipped.
- `PATTERN` — regex to find. Use `gi` flag for case-insensitive.
- `REPLACEMENT` — what to replace matches with.

### Output

Every run writes a timestamped markdown report (`replacement-report-...md`) to the working directory listing:
- Every article touched, with link
- Brand ID
- Each locale updated
- Before/after snippet for each change

Hand this report to whoever's verifying the changes.

### Safety notes

- **Dry-run by default.** You must pass `--apply` to actually write.
- **HTML-safe.** Cheerio parses the body and replacement happens only in text nodes. URLs in `href` attributes, class names, and `<code>`/`<pre>` blocks are untouched.
- **Per-translation.** For multilingual articles, each translation is processed separately so you can see which locales were affected.
- **Idempotent.** Re-running after `--apply` should find zero remaining matches and make no changes.
