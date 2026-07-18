export interface ChromeCall {
  tool: string;
  arguments?: Record<string, unknown>;
  requestId?: string;
}

export function encodeCall(call: ChromeCall): string {
  return Buffer.from(JSON.stringify(call), "utf8").toString("base64url");
}

export function decodeCall(encoded: string): ChromeCall {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Invalid base64url payload");
  const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  if (!parsed || typeof parsed !== "object") throw new Error("Payload must be an object");
  const call = parsed as ChromeCall;
  if (!call.tool || typeof call.tool !== "string") throw new Error("tool is required");
  if (call.arguments !== undefined && (typeof call.arguments !== "object" || Array.isArray(call.arguments))) {
    throw new Error("arguments must be an object");
  }
  return call;
}
