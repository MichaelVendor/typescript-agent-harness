import assert from "node:assert/strict";
import { test } from "node:test";
import { inProcessPingBackend } from "@typescript-agent-harness/mcp";

test("ping backend has no resources or prompts", async () => {
  const backend = inProcessPingBackend();
  assert.deepEqual(await backend.listResources(), []);
  assert.deepEqual(await backend.listPrompts(), []);
  await assert.rejects(backend.readResource("ping://x"), /没有/);
  await assert.rejects(backend.getPrompt("ping"), /没有/);
});
