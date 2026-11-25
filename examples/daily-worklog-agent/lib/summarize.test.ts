import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
