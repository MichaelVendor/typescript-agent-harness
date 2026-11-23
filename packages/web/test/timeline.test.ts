import assert from "node:assert/strict";
import { test } from "node:test";
import { groupTicketsForTimeline } from "../src/timeline.ts";

const t = (
  id: string,
  status: string,
  createdAt: string,
  goal = id,
) => ({ id, status, createdAt, goal });

test("empty input yields no groups", () => {
  assert.deepEqual(groupTicketsForTimeline([]), []);
});

test("fixed group order; empty groups omitted", () => {
  const grouped = groupTicketsForTimeline([
    t("d1", "done", "2026-01-03T10:00:00Z"),
    t("r1", "running", "2026-01-02T10:00:00Z"),
    t("h1", "needs_human", "2026-01-01T10:00:00Z"),
    t("f1", "failed", "2026-01-04T10:00:00Z"),
  ]);
  assert.deepEqual(
    grouped.map((g) => g.id),
    ["needs_human", "running", "done", "failed"],
  );
});

test("within group tickets sorted by createdAt desc", () => {
  const grouped = groupTicketsForTimeline([
    t("d-old", "done", "2026-01-01T10:00:00Z"),
    t("d-new", "done", "2026-01-03T10:00:00Z"),
    t("d-mid", "done", "2026-01-02T10:00:00Z"),
  ]);
  assert.equal(grouped.length, 1);
  assert.deepEqual(
    grouped[0]!.tickets.map((x) => x.id),
    ["d-new", "d-mid", "d-old"],
  );
});

test("unknown status is skipped", () => {
  const grouped = groupTicketsForTimeline([
    t("q1", "queued", "2026-01-01T10:00:00Z"),
    t("x1", "unknown", "2026-01-02T10:00:00Z"),
  ]);
  assert.deepEqual(grouped.map((g) => g.id), ["queued"]);
  assert.deepEqual(grouped[0]!.tickets.map((x) => x.id), ["q1"]);
});