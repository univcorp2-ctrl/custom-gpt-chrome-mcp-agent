import test from "node:test";
import assert from "node:assert/strict";
import { validateCall, type PolicyConfig } from "../src/security.js";

const policy: PolicyConfig = { allowedHosts: ["developer.chrome.com", "*.example.com"], allowInteraction: true, allowPrivileged: false, allowUpload: false, uploadRoot: "/tmp/uploads" };

test("allows navigation to exact and wildcard hosts", () => {
  assert.doesNotThrow(() => validateCall("navigate_page", { url: "https://developer.chrome.com/docs" }, policy));
  assert.doesNotThrow(() => validateCall("new_page", { url: "https://app.example.com" }, policy));
});

test("blocks non-allowlisted hosts", () => {
  assert.throws(() => validateCall("navigate_page", { url: "https://evil.invalid" }, policy), /not allowlisted/);
});

test("blocks privileged tools by default", () => {
  assert.throws(() => validateCall("evaluate_script", { function: "() => 1" }, policy), /disabled/);
});
