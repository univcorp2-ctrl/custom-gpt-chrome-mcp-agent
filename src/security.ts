import path from "node:path";

export const READ_TOOLS = new Set([
  "list_pages", "take_snapshot", "take_screenshot", "list_console_messages",
  "get_console_message", "list_network_requests", "get_network_request",
  "lighthouse_audit", "performance_start_trace", "performance_stop_trace",
  "performance_analyze_insight", "take_heapsnapshot", "close_heapsnapshot",
  "compare_heapsnapshots", "get_heapsnapshot_class_nodes", "get_heapsnapshot_details",
  "get_heapsnapshot_dominators", "get_heapsnapshot_duplicate_strings",
  "get_heapsnapshot_edges", "get_heapsnapshot_object_details", "get_heapsnapshot_retainers",
  "get_heapsnapshot_retaining_paths", "get_heapsnapshot_summary"
]);

export const INTERACTION_TOOLS = new Set([
  "click", "drag", "fill", "fill_form", "handle_dialog", "hover", "press_key",
  "type_text", "click_at", "close_page", "navigate_page", "new_page", "select_page",
  "wait_for", "emulate", "resize_page"
]);

export const PRIVILEGED_TOOLS = new Set([
  "evaluate_script", "upload_file", "install_extension", "reload_extension",
  "trigger_extension_action", "uninstall_extension", "execute_3p_developer_tool",
  "execute_webmcp_tool"
]);

export interface PolicyConfig {
  allowedHosts: string[];
  allowInteraction: boolean;
  allowPrivileged: boolean;
  allowUpload: boolean;
  uploadRoot: string;
}

function hostAllowed(hostname: string, patterns: string[]): boolean {
  const host = hostname.toLowerCase();
  return patterns.some((raw) => {
    const pattern = raw.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === "*") return true;
    if (pattern.startsWith("*.")) {
      const suffix = pattern.slice(2);
      return host === suffix || host.endsWith(`.${suffix}`);
    }
    return host === pattern;
  });
}

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object") Object.values(value as Record<string, unknown>).forEach((item) => collectStrings(item, out));
  return out;
}

export function validateCall(tool: string, args: Record<string, unknown>, config: PolicyConfig): void {
  if (READ_TOOLS.has(tool)) {
    // allowed
  } else if (INTERACTION_TOOLS.has(tool)) {
    if (!config.allowInteraction) throw new Error(`Interaction tool disabled: ${tool}`);
  } else if (PRIVILEGED_TOOLS.has(tool)) {
    if (tool === "upload_file" && !config.allowUpload) throw new Error("File upload is disabled");
    if (!config.allowPrivileged) throw new Error(`Privileged tool disabled: ${tool}`);
  } else {
    throw new Error(`Tool is not allowlisted: ${tool}`);
  }

  for (const value of collectStrings(args)) {
    if (/^https?:\/\//i.test(value)) {
      const url = new URL(value);
      if (!hostAllowed(url.hostname, config.allowedHosts)) throw new Error(`Host is not allowlisted: ${url.hostname}`);
    }
  }

  if (tool === "upload_file") {
    const root = path.resolve(config.uploadRoot);
    for (const value of collectStrings(args)) {
      if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
        const resolved = path.resolve(value);
        if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Upload path is outside UPLOAD_ROOT");
      }
    }
  }
}

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = /token|secret|password|authorization|cookie/i.test(key) ? "[REDACTED]" : redact(item);
  }
  return result;
}
