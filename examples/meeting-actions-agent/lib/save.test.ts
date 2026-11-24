import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { saveActions } from "./save.ts";
import type { ActionBatch } from "./confirm.ts";

test("save rejects unconfirmed batch", () => {
  assert.throws(
    () => saveActions({ rows: [], gaps: [], confirmed: false }),
    /not confirmed/,
  );
});

test("save rejects confirmed batch with null action owner unless allowUnowned", () => {
  const batch: ActionBatch = {
    confirmed: true,
    gaps: [],
    rows: [
      {
        id: "a1",
        kind: "action",
        text: "x",
        owner: null,
        due: null,
        priority: null,
        evidence: "e",
      },
    ],
  };
  assert.throws(() => saveActions(batch), /unowned actions/);
  const outDir = mkdtempSync(path.join(os.tmpdir(), "meeting-actions-"));
  try {
    const saved = saveActions(batch, { allowUnowned: true, outDir });
    assert.match(saved.mdPath, /actions/);
    assert.equal(existsSync(saved.mdPath), true);
    assert.equal(existsSync(saved.jsonPath), true);
    const tasksPath = path.join(outDir, "tasks.jsonl");
    assert.equal(existsSync(tasksPath), true);
    const record = JSON.parse(readFileSync(tasksPath, "utf8").trim()) as {
      ts: string;
      rowIds: string[];
    };
    assert.deepEqual(record.rowIds, ["a1"]);
    assert.ok(record.ts);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test("save writes md and json for confirmed batch with owners", () => {
  const batch: ActionBatch = {
    confirmed: true,
    gaps: [],
    rows: [
      {
        id: "a1",
        kind: "action",
        text: "改登录",
        owner: "李华",
        due: null,
        priority: "P1",
        evidence: "e",
      },
    ],
  };
  const outDir = mkdtempSync(path.join(os.tmpdir(), "meeting-actions-"));
  try {
    const now = new Date("2026-11-24T08:00:00.000Z");
    const saved = saveActions(batch, { outDir, now });
    assert.match(saved.mdPath, /actions/);
    assert.equal(readFileSync(saved.mdPath, "utf8").includes("改登录"), true);
    const json = JSON.parse(readFileSync(saved.jsonPath, "utf8")) as ActionBatch;
    assert.equal(json.confirmed, true);
    assert.equal(json.rows[0]!.owner, "李华");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});