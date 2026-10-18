import assert from "node:assert/strict";
import { test } from "node:test";
import { signAgentHostToken, verifyAgentHostToken } from "../dist/agent-host/auth.js";

test("sign and verify round-trip; rejects bad secret, expiry, wrong project", () => {
  const secret = "test-secret";
  const claims = { projectId: "proj_a", userId: "u1", exp: Math.floor(Date.now() / 1000) + 60 };
  const token = signAgentHostToken(secret, claims);
  assert.deepEqual(verifyAgentHostToken(secret, token, "proj_a"), claims);
  assert.throws(() => verifyAgentHostToken("other", token, "proj_a"), /invalid/);
  assert.throws(() => verifyAgentHostToken(secret, token, "proj_b"), /project/);
  const expired = signAgentHostToken(secret, { ...claims, exp: 1 });
  assert.throws(() => verifyAgentHostToken(secret, expired, "proj_a", 100), /expir/);

  const missingExp = signAgentHostToken(secret, { projectId: "proj_a", userId: "u1" } as typeof claims);
  assert.throws(() => verifyAgentHostToken(secret, missingExp, "proj_a", 100), /invalid/);
  const badExp = signAgentHostToken(secret, { ...claims, exp: "9999999999" } as unknown as typeof claims);
  assert.throws(() => verifyAgentHostToken(secret, badExp, "proj_a", 100), /invalid/);
  const missingUser = signAgentHostToken(secret, { projectId: "proj_a", exp: claims.exp } as typeof claims);
  assert.throws(() => verifyAgentHostToken(secret, missingUser, "proj_a", 100), /invalid/);
});
