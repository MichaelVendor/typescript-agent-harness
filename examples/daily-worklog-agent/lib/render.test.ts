import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderDayCard } from "./render.ts";
import type { DayBundle } from "./schema.ts";

const fixture = JSON.parse(
  readFileSync(new URL("../data/fixtures/bundle-sample.json", import.meta.url), "utf8"),
) as DayBundle;

test("renders date, summary, evidence sections and gaps", () => {
  const { markdown } = renderDayCard(fixture, "SUMMARY-TEXT");
  assert.match(markdown, /^# 2026-11-25/);
  assert.match(markdown, /SUMMARY-TEXT/);
  assert.match(markdown, /abc1234/);
  assert.match(markdown, /agent-transcripts\/sample\.jsonl/);
  assert.match(markdown, /https:\/\/github\.com\/foo/);
  assert.match(markdown, /## Gaps/);
  assert.match(markdown, /browser: history partial/);
});
