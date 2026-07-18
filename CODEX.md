# Agent instructions

- Keep `chrome-devtools-mcp` pinned and review upstream release notes before upgrades.
- Never weaken URL allowlisting or expose port 8788 publicly.
- Preserve URL-secret and Bearer authentication modes.
- New tools must be classified in `READ_TOOLS`, `INTERACTION_TOOLS`, or `PRIVILEGED_TOOLS` and covered by tests.
- Never log cookies, authorization headers, passwords, tokens, or raw secrets.
- Run `npm run lint`, `npm test`, and `docker build .` before release.
