import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectCursor } from "./collect-cursor.ts";

function tmp(): string {
  return mkdtempSync(path.join(os.tmpdir(), "wl-cursor-"));
}

test("collects today's transcripts with workspace name", () => {
  const root = tmp();
  const dir = path.join(root, "proj-a", "agent-transcripts");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "x.jsonl");
  writeFileSync(file, "{}\n");
  const mtime = new Date("2026-11-25T04:00:00Z"); // 12:00 Shanghai
  utimesSync(file, mtime, mtime);

  const r = collectCursor(root, "2026-11-25", "Asia/Shanghai");
  assert.deepEqual(r.gaps, []);
  assert.equal(r.cursor.length, 1);
  assert.equal(r.cursor[0]!.workspace, "proj-a");
  assert.equal(r.cursor[0]!.note, "x.jsonl");
  assert.equal(r.cursor[0]!.evidence, file);
});

test("finds nested transcripts and ignores other days", () => {
  const root = tmp();
  const nested = path.join(root, "proj-b", "agent-transcripts", "uuid");
  mkdirSync(nested, { recursive: true });
  const today = path.join(nested, "uuid.jsonl");
  const old = path.join(root, "proj-b", "agent-transcripts", "old.jsonl");
  writeFileSync(today, "{}\n");
  writeFileSync(old, "{}\n");
  const t = new Date("2026-11-25T04:00:00Z");
  const o = new Date("2026-11-20T04:00:00Z");
  utimesSync(today, t, t);
  utimesSync(old, o, o);

  const r = collectCursor(root, "2026-11-25", "Asia/Shanghai");
  assert.deepEqual(r.cursor.map((c) => c.note), ["uuid.jsonl"]);
});

test("empty root yields a gap", () => {
  const r = collectCursor(tmp(), "2026-11-25", "Asia/Shanghai");
  assert.deepEqual(r.cursor, []);
  assert.equal(r.gaps.length, 1);
  assert.match(r.gaps[0]!, /^cursor:/);
});

test("missing root yields a gap", () => {
  const r = collectCursor("/nonexistent/projects-root", "2026-11-25", "Asia/Shanghai");
  assert.match(r.gaps[0]!, /^cursor:/);
});
