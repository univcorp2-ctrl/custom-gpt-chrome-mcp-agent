import test from "node:test";
import assert from "node:assert/strict";
import { assertAllowedUrl, classifyRisk, requiredGptEndpoints, sign, verify } from "../src/contracts.js";

test("Custom GPT contract exposes exactly the five browser Actions", () => {
  assert.deepEqual(requiredGptEndpoints, [
    "POST /v1/browser/tasks",
    "GET /v1/browser/tasks/{task_id}",
    "POST /v1/browser/tasks/{task_id}/approve",
    "POST /v1/browser/tasks/{task_id}/cancel",
    "GET /v1/browser/capabilities"
  ]);
});

test("read-only navigation is queued without approval", () => {
  assert.equal(classifyRisk({ objective: "ページを開いて情報を取得", actions: [{ tool: "new_page", arguments: { url: "https://developer.chrome.com" } }] }).approvalRequired, false);
});

test("purchase, publish, delete and privileged tools require approval", () => {
  assert.equal(classifyRisk({ objective: "商品を購入して決済" }).approvalRequired, true);
  assert.equal(classifyRisk({ objective: "inspect", actions: [{ tool: "evaluate_script", arguments: {} }] }).approvalRequired, true);
});

test("HMAC signed task detects tampering", () => {
  const signature = sign("shared-secret", "task-json");
  assert.equal(verify("shared-secret", "task-json", signature), true);
  assert.equal(verify("shared-secret", "changed", signature), false);
});

test("local domain allowlist rejects unapproved destinations", () => {
  assert.doesNotThrow(() => assertAllowedUrl("https://app.example.com/path", ["*.example.com"]));
  assert.throws(() => assertAllowedUrl("https://evil.invalid", ["*.example.com"]), /not allowlisted/);
});
