import assert from "node:assert/strict";
import { test } from "node:test";
import { checkWorkerBearer } from "../dist/agent-worker/auth.js";

test("checkWorkerBearer accepts matching Bearer and rejects others", () => {
  assert.equal(checkWorkerBearer("Bearer secret-token", "secret-token"), true);
  assert.equal(checkWorkerBearer("bearer secret-token", "secret-token"), true);
  assert.equal(checkWorkerBearer("Bearer wrong", "secret-token"), false);
  assert.equal(checkWorkerBearer(undefined, "secret-token"), false);
  assert.equal(checkWorkerBearer("Basic x", "secret-token"), false);
});