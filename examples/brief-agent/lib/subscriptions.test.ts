import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  loadSubscriptions,
  setSubscriptionsPathForTest,
  upsertSubscription,
} from "./subscriptions.ts";
import { runWeeklyBriefs } from "./weekly-brief.ts";

describe("subscriptions", () => {
  it("upserts and weekly runs mock brief + tasks", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "brief-sub-"));
    const subFile = path.join(dir, "subscriptions.json");
    const briefsDir = path.join(dir, "briefs");
    setSubscriptionsPathForTest(subFile);

    const { subscription } = upsertSubscription({
      id: "weekly-demo",
      targets: [{ id: "B001" }, { id: "B002" }],
      template: "ops",
      now: new Date("2026-11-22T01:00:00.000Z"),
    });
    assert.equal(subscription.enabled, true);
    assert.equal(loadSubscriptions().subscriptions.length, 1);

    const results = await runWeeklyBriefs({
      subscriptionsPath: subFile,
      briefsDir,
      now: new Date("2026-11-22T01:00:00.000Z"),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.ok, true);
    assert.ok(results[0]?.mdPath);
    const tasks = readFileSync(path.join(briefsDir, "tasks.jsonl"), "utf8").trim();
    assert.ok(tasks.includes('"rowCount":2'));
    assert.ok(tasks.includes("weekly") || tasks.includes("B001"));

    setSubscriptionsPathForTest(null);
    rmSync(dir, { recursive: true, force: true });
  });
});
