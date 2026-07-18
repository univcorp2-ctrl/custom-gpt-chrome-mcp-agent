import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { decodeCall, type ChromeCall } from "./codec.js";
import { ChromeMcpClient } from "./mcp-client.js";
import { INTERACTION_TOOLS, PRIVILEGED_TOOLS, READ_TOOLS, redact, validateCall, type PolicyConfig } from "./security.js";

const port = Number(process.env.PORT ?? 8788);
const host = process.env.HOST ?? "0.0.0.0";
const urlSecret = process.env.URL_SECRET ?? "";
const bearerToken = process.env.AGENT_API_TOKEN ?? "";
if (!urlSecret && !bearerToken) throw new Error("Set URL_SECRET or AGENT_API_TOKEN");

const uploadRoot = path.resolve(process.env.UPLOAD_ROOT ?? path.join(os.homedir(), ".local", "share", "custom-gpt-chrome-mcp", "uploads"));
const auditDir = path.resolve(process.env.AUDIT_DIR ?? path.join(os.homedir(), ".local", "state", "custom-gpt-chrome-mcp", "audit"));
const profileDir = path.resolve(process.env.CHROME_PROFILE_DIR ?? path.join(os.homedir(), ".cache", "custom-gpt-chrome-mcp", "profile"));
const allowedHosts = (process.env.ALLOWED_HOSTS ?? "developer.chrome.com,localhost,127.0.0.1").split(",").map((v) => v.trim()).filter(Boolean);
const allowedUrlPatterns = (process.env.ALLOWED_URL_PATTERNS ?? allowedHosts.filter((h) => h !== "localhost" && h !== "127.0.0.1").map((h) => `https://${h}/**`).join(","))
  .split(",").map((v) => v.trim()).filter(Boolean);

const policy: PolicyConfig = {
  allowedHosts,
  allowInteraction: (process.env.ALLOW_INTERACTION_TOOLS ?? "true") === "true",
  allowPrivileged: (process.env.ALLOW_PRIVILEGED_TOOLS ?? "false") === "true",
  allowUpload: (process.env.ALLOW_FILE_UPLOAD ?? "false") === "true",
  uploadRoot
};

const mcp = new ChromeMcpClient({
  packageSpec: process.env.CHROME_MCP_PACKAGE ?? "chrome-devtools-mcp@1.6.0",
  profileDir,
  uploadRoot,
  headless: (process.env.CHROME_HEADLESS ?? "false") === "true",
  allowedUrlPatterns,
  enableWebMcp: (process.env.ENABLE_WEBMCP ?? "false") === "true",
  timeoutMs: Number(process.env.MCP_TIMEOUT_MS ?? 120000)
});

function constantTimeEquals(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}

function authenticate(req: IncomingMessage, pathname: string): { ok: boolean; route: string } {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] === "t" && parts[1] && urlSecret && constantTimeEquals(parts[1], urlSecret)) {
    return { ok: true, route: `/${parts.slice(2).join("/")}` };
  }
  const auth = req.headers.authorization ?? "";
  if (bearerToken && auth.startsWith("Bearer ") && constantTimeEquals(auth.slice(7), bearerToken)) return { ok: true, route: pathname };
  return { ok: false, route: pathname };
}

async function readJson(req: IncomingMessage): Promise<ChromeCall> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk); size += buffer.length;
    if (size > 1024 * 1024) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as ChromeCall;
  if (!parsed.tool || typeof parsed.tool !== "string") throw new Error("tool is required");
  return parsed;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function audit(entry: Record<string, unknown>): Promise<void> {
  await mkdir(auditDir, { recursive: true, mode: 0o700 });
  const date = new Date().toISOString().slice(0, 10);
  await appendFile(path.join(auditDir, `${date}.jsonl`), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

function openApi(origin: string, secret: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: { title: "Custom GPT Chrome DevTools MCP Agent", version: "1.0.0", description: "Securely call allowlisted Chrome DevTools MCP tools on a dedicated Chrome profile." },
    servers: [{ url: `${origin}/t/${secret}` }],
    paths: {
      "/health": { get: { operationId: "chromeMcpHealth", summary: "Check Chrome MCP agent health", responses: { "200": { description: "Health response" } } } },
      "/v1/tools": { get: { operationId: "listChromeMcpTools", summary: "List permitted Chrome MCP tools", responses: { "200": { description: "Tool list" } } } },
      "/v1/call": { post: { operationId: "callChromeMcpTool", summary: "Call one permitted Chrome DevTools MCP tool", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["tool"], properties: { tool: { type: "string" }, arguments: { type: "object", additionalProperties: true }, requestId: { type: "string" } } } } } }, responses: { "200": { description: "MCP tool result" }, "400": { description: "Policy or input error" } } } }
    }
  };
}

const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const requestId = req.headers["x-request-id"]?.toString() ?? randomUUID();
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") return send(res, 200, { ok: true, service: "custom-gpt-chrome-mcp-agent", mcpRunning: mcp.isRunning(), version: "1.0.0" });
  const auth = authenticate(req, url.pathname);
  if (!auth.ok) return send(res, 401, { ok: false, error: "unauthorized" });

  try {
    if (req.method === "GET" && auth.route === "/health") return send(res, 200, { ok: true, service: "custom-gpt-chrome-mcp-agent", mcpRunning: mcp.isRunning(), version: "1.0.0", policy: { allowedHosts, allowInteraction: policy.allowInteraction, allowPrivileged: policy.allowPrivileged, allowUpload: policy.allowUpload } });
    if (req.method === "GET" && auth.route === "/openapi.json") return send(res, 200, openApi(url.origin, urlSecret));
    if (req.method === "GET" && auth.route === "/v1/tools") {
      const raw = await mcp.listTools() as { tools?: Array<{ name?: string }> };
      const tools = (raw.tools ?? []).filter((item) => item.name && (READ_TOOLS.has(item.name) || (policy.allowInteraction && INTERACTION_TOOLS.has(item.name)) || (policy.allowPrivileged && PRIVILEGED_TOOLS.has(item.name))));
      return send(res, 200, { ok: true, tools });
    }

    let call: ChromeCall | undefined;
    if (req.method === "POST" && auth.route === "/v1/call") call = await readJson(req);
    else if ((req.method === "POST" || req.method === "GET") && auth.route.startsWith("/v1/call/")) call = decodeCall(auth.route.slice("/v1/call/".length));
    if (!call) return send(res, 404, { ok: false, error: "not_found" });

    const args = call.arguments ?? {};
    validateCall(call.tool, args, policy);
    const result = await mcp.callTool(call.tool, args);
    await audit({ at: new Date().toISOString(), requestId, tool: call.tool, arguments: redact(args), ok: true, durationMs: Date.now() - started });
    return send(res, 200, { ok: true, requestId, tool: call.tool, durationMs: Date.now() - started, result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await audit({ at: new Date().toISOString(), requestId, ok: false, error: message, durationMs: Date.now() - started });
    return send(res, /disabled|allowlist|outside|Invalid|required|large/i.test(message) ? 400 : 500, { ok: false, requestId, error: message });
  }
});

server.listen(port, host, () => console.log(`custom-gpt-chrome-mcp-agent listening on http://${host}:${port}`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { mcp.stop(); server.close(() => process.exit(0)); });
