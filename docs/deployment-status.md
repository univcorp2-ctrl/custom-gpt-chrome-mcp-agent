# Deployment status

- GitHub repository: `univcorp2-ctrl/custom-gpt-chrome-mcp-agent`
- Production documentation site: `https://custom-gpt-chrome-mcp-agent.pages.dev`
- Local agent health: `http://127.0.0.1:8788/health`
- Custom GPT schema after tunnel setup: `https://YOUR_HOSTNAME/t/YOUR_URL_SECRET/openapi.json`
- Branch: `main`
- CI: GitHub Actions workflow `.github/workflows/ci.yml`

The Pages URL hosts public setup documentation. Chrome execution remains on the dedicated local agent and is exposed only through a named Cloudflare Tunnel.
