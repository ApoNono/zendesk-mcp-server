# Contributing

Thanks for your interest in improving this project. PRs are welcome.

## Setup

```bash
git clone https://github.com/ApoNono/zendesk-mcp-server.git
cd zendesk-mcp-server
npm install
```

Copy `.env.example` to `.env` and fill in real Zendesk credentials if you want to run the server locally.

## Workflow

1. Fork and create a feature branch off `main`.
2. Make your change. Keep PRs focused — one logical change per PR.
3. Before pushing:
   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```
   All four must pass. CI runs the same on Node 18, 20, and 22.
4. Open a PR with a clear description of what changed and why.

## Adding a new tool

1. Create a new file under `src/tools/<category>/` extending `BaseTool`.
2. Define a JSON schema for parameters.
3. Implement `executeInternal` — make the API call, transform the response into something concise the LLM will use well.
4. Add the tool to its category's `index.ts` exports.
5. Register it in the constructor list in `src/core/server.ts`.
6. Add at least one test under `tests/`.

See `src/tools/articles/get-article.ts` for a minimal example.

## Style

- TypeScript strict mode.
- Keep code minimal. Don't add error handling for cases that can't happen, or abstractions for hypothetical future tools.
- Prefer editing existing files over creating new ones.
- Don't add comments that just restate what the code does.

## Reporting bugs

Open an issue with:
- What you expected to happen
- What actually happened
- A minimal reproduction (env vars used, MCP client, query that triggered it)
- Logs from `LOG_LEVEL=debug` if relevant

## License

By contributing, you agree your contributions will be licensed under the project's [MIT License](LICENSE).
