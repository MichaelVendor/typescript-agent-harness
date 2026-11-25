import test from "node:test";
import assert from "node:assert/strict";
import { validateDayBundle } from "./schema.ts";

test("accepts minimal bundle with gaps", () => {
  assert.equal(validateDayBundle({
    date: "2026-11-25",
    git: [],
    cursor: [],
    browser: [],
    gaps: ["browser: not configured"],
  }).length, 0);
});

test("rejects bad date", () => {
  assert.ok(validateDayBundle({
    date: "25-11-2026",
    git: [], cursor: [], browser: [], gaps: [],
  }).some((p) => /date/i.test(p)));
});