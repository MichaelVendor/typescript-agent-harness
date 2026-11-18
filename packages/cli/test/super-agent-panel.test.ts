import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import { readSuperAgentPanel } from "../dist/serve/super-agent-panel.js";

test("parseArgv --super-agent-panel", () => {
  const flags = parseArgv(["serve", "--super-agent-panel", "./out/sa"]);
  assert.equal(flags.superAgentPanel, "./out/sa");
});

test("readSuperAgentPanel 读 panel.json", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-sa-panel-"));
  writeFileSync(
    path.join(dir, "panel.json"),
    JSON.stringify({
      agentId: "a1",
      status: "needs_human",
      needsHuman: [
        {
          id: "t1",
          mandateId: "m1",
          goal: "deploy?",
          status: "needs_human",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      running: [],
      recentReplies: ["[needs_human] deploy?"],
      subscriptions: [{ threadId: "pr:1", ticketId: "t1" }],
    }),
  );
  const snap = readSuperAgentPanel(dir);
  assert.equal(snap.agentId, "a1");
  assert.equal(snap.status, "needs_human");
  assert.equal(snap.needsHuman[0]?.goal, "deploy?");
  assert.equal(snap.subscriptions[0]?.threadId, "pr:1");
});

test("readSuperAgentPanel 缺文件抛错", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-sa-empty-"));
  assert.throws(() => readSuperAgentPanel(dir), /no panel\.json/);
});
