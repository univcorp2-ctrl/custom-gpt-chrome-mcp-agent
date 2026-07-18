import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export interface McpOptions {
  packageSpec: string;
  profileDir: string;
  uploadRoot: string;
  headless: boolean;
  allowedUrlPatterns: string[];
  enableWebMcp: boolean;
  timeoutMs: number;
}

export class ChromeMcpClient {
  private child?: ChildProcessWithoutNullStreams;
  private startPromise?: Promise<void>;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private buffer = "";

  constructor(private readonly options: McpOptions) {}

  isRunning(): boolean {
    return Boolean(this.child && !this.child.killed && this.child.exitCode === null);
  }

  async start(): Promise<void> {
    if (this.isRunning()) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.doStart().finally(() => { this.startPromise = undefined; });
    return this.startPromise;
  }

  private async doStart(): Promise<void> {
    await mkdir(this.options.profileDir, { recursive: true, mode: 0o700 });
    await mkdir(this.options.uploadRoot, { recursive: true, mode: 0o700 });
    const args = [
      "-y", this.options.packageSpec,
      `--user-data-dir=${this.options.profileDir}`,
      "--no-usage-statistics",
      "--no-performance-crux",
      "--redact-network-headers=true",
      "--screenshot-format=webp",
      "--screenshot-quality=75",
      "--screenshot-max-width=1600",
      "--screenshot-max-height=1200"
    ];
    if (this.options.headless) args.push("--headless=true");
    for (const pattern of this.options.allowedUrlPatterns) args.push(`--allowed-url-pattern=${pattern}`);
    if (this.options.enableWebMcp) {
      args.push("--category-experimental-webmcp=true");
      args.push("--chrome-arg=--enable-features=WebMCP,DevToolsWebMCPSupport");
    }

    this.child = spawn(process.env.NPX_BIN ?? "npx", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: "1",
        CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: "1"
      }
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onData(chunk));
    this.child.stderr.on("data", (chunk: string) => process.stderr.write(`[chrome-mcp] ${chunk}`));
    this.child.on("exit", (code, signal) => {
      const error = new Error(`Chrome MCP exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
      this.pending.clear();
      this.child = undefined;
    });

    await this.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: { roots: { listChanged: false } },
      clientInfo: { name: "custom-gpt-chrome-mcp-agent", version: "1.0.0" }
    });
    this.notify("notifications/initialized", {});
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let index: number;
    while ((index = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line.startsWith("{")) continue;
      try { this.onMessage(JSON.parse(line) as Record<string, unknown>); }
      catch { process.stderr.write(`[chrome-mcp] ignored non-JSON line\n`); }
    }
  }

  private onMessage(message: Record<string, unknown>): void {
    if (typeof message.id === "number" && typeof message.method === "string") {
      if (message.method === "roots/list") {
        this.write({ jsonrpc: "2.0", id: message.id, result: { roots: [{ uri: pathToFileURL(path.resolve(this.options.uploadRoot)).href, name: "uploads" }] } });
      } else if (message.method === "ping") {
        this.write({ jsonrpc: "2.0", id: message.id, result: {} });
      } else {
        this.write({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not supported" } });
      }
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message.result);
  }

  private write(message: Record<string, unknown>): void {
    if (!this.child?.stdin.writable) throw new Error("Chrome MCP stdin is unavailable");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, this.options.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: Record<string, unknown>): void {
    this.write({ jsonrpc: "2.0", method, params });
  }

  async listTools(): Promise<unknown> {
    await this.start();
    return this.request("tools/list", {});
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    await this.start();
    try {
      return await this.request("tools/call", { name, arguments: args });
    } catch (error) {
      if (!this.isRunning()) { await this.start(); return this.request("tools/call", { name, arguments: args }); }
      throw error;
    }
  }

  stop(): void {
    this.child?.kill("SIGTERM");
  }
}
