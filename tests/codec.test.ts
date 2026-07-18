import test from "node:test";
import assert from "node:assert/strict";
import { decodeCall, encodeCall } from "../src/codec.js";

test("Chrome call codec round-trips UTF-8 arguments", () => {
  const input = { tool: "navigate_page", arguments: { url: "https://developer.chrome.com/日本語" }, requestId: "abc" };
  assert.deepEqual(decodeCall(encodeCall(input)), input);
});

test("codec rejects malformed payload", () => {
  assert.throws(() => decodeCall("***"), /Invalid/);
});
