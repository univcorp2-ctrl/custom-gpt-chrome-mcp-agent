import { createHmac, timingSafeEqual } from "node:crypto";

export interface BrowserAction { tool: string; arguments?: Record<string, unknown>; requires_approval?: boolean; }
export interface BrowserTask { objective: string; actions?: BrowserAction[]; domain_allowlist?: string[]; }

const sensitive = /(purchase|buy|checkout|payment|transfer|submit|send|publish|delete|購入|決済|支払|振込|送信|公開|投稿|削除)/i;
const privileged = new Set(["evaluate_script", "upload_file", "install_extension", "uninstall_extension", "execute_webmcp_tool"]);

export function classifyRisk(task: BrowserTask): { approvalRequired: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (sensitive.test(task.objective)) reasons.push("sensitive_objective");
  for (const action of task.actions ?? []) {
    if (action.requires_approval) reasons.push(`explicit:${action.tool}`);
    if (privileged.has(action.tool)) reasons.push(`privileged:${action.tool}`);
    if (sensitive.test(JSON.stringify(action.arguments ?? {}))) reasons.push(`sensitive_arguments:${action.tool}`);
  }
  return { approvalRequired: reasons.length > 0, reasons };
}

export function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verify(secret: string, payload: string, signature: string): boolean {
  const expected = Buffer.from(sign(secret, payload));
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function assertAllowedUrl(url: string, allowed: string[]): void {
  const host = new URL(url).hostname.toLowerCase();
  const ok = allowed.some((raw) => {
    const rule = raw.toLowerCase();
    return rule.startsWith("*.") ? host === rule.slice(2) || host.endsWith(rule.slice(1)) : host === rule;
  });
  if (!ok) throw new Error(`domain is not allowlisted: ${host}`);
}

export const requiredGptEndpoints = [
  "POST /v1/browser/tasks",
  "GET /v1/browser/tasks/{task_id}",
  "POST /v1/browser/tasks/{task_id}/approve",
  "POST /v1/browser/tasks/{task_id}/cancel",
  "GET /v1/browser/capabilities"
] as const;
