import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveDayCard } from "./save.ts";
import { summarizeFromBundle } from "./summarize.ts";
import type { DayBundle } from "./schema.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../data/fixtures/bundle-sample.json", import.meta.url), "utf8"),
) as DayBundle;

test("summary references bundle evidence only", () => {
  const s = summarizeFromBundle(fixture);
  assert.match(s, /abc1234/);
  assert.match(s, /feat: sample commit/);
  assert.match(s, /github\.com\/foo/);
  assert.match(s, /browser: history partial/);
});

test("empty bundle summary mentions no activity", () => {
  const s = summarizeFromBundle({ date: "2026-11-25", git: [], cursor: [], browser: [], gaps: [] });
  assert.match(s, /无|no activity/i);
});

test("summary of real-shaped cursor evidence passes the save gate", () => {
  const p = "/Users/u/.cursor/projects/p/agent-transcripts/06688cae-80de-4a35-b113-bf7c50f5fbd7/06688cae-80de-4a35-b113-bf7c50f5fbd7.jsonl";
  const b: DayBundle = {
    date: "2026-11-25",
    git: [{ repo: "/r", commits: [{ hash: "abc1234def5678", subject: "feat: x" }] }],
    cursor: [{ workspace: "p", note: "06688cae-80de-4a35-b113-bf7c50f5fbd7.jsonl", evidence: p }],
    browser: [{ url: "https://github.com/foo", title: "foo" }],
    gaps: [],
  };
  const out = mkdtempSync(path.join(os.tmpdir(), "wl-"));
  assert.doesNotThrow(() => saveDayCard(b, summarizeFromBundle(b), { outDir: out }));
});
