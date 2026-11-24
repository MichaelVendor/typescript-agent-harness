import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { matchesMessageSubsequence } from "@typescript-agent-harness/agent";
import { createRoomHost } from "../dist/serve/room-host.js";

test("mock room-host: goal + steps produce delegate/result/done", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-room-host-"));
  const host = createRoomHost({ cwd, mock: true, persistDir: path.join(cwd, ".tah", "room") });
  host.setGoal("评估合规");
  await host.step();
  await host.step();
  await host.step();
  const snap = host.getSnapshot();
  assert.equal(snap.meta.status, "done");
  assert.ok(
    matchesMessageSubsequence(snap.messages, [
      { from: "user", kind: "chat" },
      { from: "tl", kind: "delegate" },
      { from: "researcher", kind: "result" },
      { from: "tl", kind: "status" },
    ]),
  );
});