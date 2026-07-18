# Initial setup

## 1. Start the agent

```bash
cp .env.example .env
```

Set long random values for `URL_SECRET` and `AGENT_API_TOKEN`. Replace `ALLOWED_HOSTS` and `ALLOWED_URL_PATTERNS` with only the sites the GPT may access. Then run:

```bash
docker compose up -d --build
docker compose logs -f chrome-agent
```

Local health check:

```bash
curl http://127.0.0.1:8788/health
```

## 2. Create the stable HTTPS URL

Create a named Cloudflare Tunnel whose public hostname routes to `http://chrome-agent:8788`, place the tunnel token in `CLOUDFLARED_TUNNEL_TOKEN`, and restart `docker compose`. Do not expose port 8788 directly to the internet.

## 3. Connect this Custom GPT directly

Open the generated schema URL:

```text
https://YOUR_HOSTNAME/t/YOUR_URL_SECRET/openapi.json
```

In GPT Builder, add an Action from that URL and set Authentication to **None**. The secret is already in the server URL. Never paste GitHub, Google, or Cloudflare tokens into the GPT.

## 4. Existing Cloudflare Worker relay option

The agent also accepts `Authorization: Bearer AGENT_API_TOKEN`. A Worker can forward to `/v1/call` or call the body-free compatibility endpoint `/v1/call/{base64url-json}`. Keep the Worker secret and the local agent token separate.

## 5. Safe defaults

- Interaction tools: enabled.
- `evaluate_script`, extension changes, third-party tools, WebMCP execution: disabled.
- File upload: disabled.
- Usage statistics and CrUX lookup: disabled.
- Network headers: redacted.
- Chrome profile: dedicated volume.

Enable privileged features only for a narrow domain allowlist. Audit logs are stored in the `audit` Docker volume as daily JSONL files.

## Production requirements

A machine that remains powered on, current stable Chrome, Node.js 22+ or Docker, a named Cloudflare Tunnel, and an allowlist limited to approved domains. Logged-in automation should use a dedicated service account and dedicated Chrome profile.
