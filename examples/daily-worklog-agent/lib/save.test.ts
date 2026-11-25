import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { saveBundle, saveDayCard } from "./save.ts";
import type { DayBundle } from "./schema.ts";

const bundle: DayBundle = {
  date: "2026-11-25",
  git: [{ repo: "/r", commits: [{ hash: "abc1234", subject: "feat: x" }] }],
  cursor: [],
  browser: [{ url: "https://github.com/foo", title: "foo" }],
  gaps: [],
};
const tmp = () => mkdtempSync(path.join(os.tmpdir(), "wl-"));

test("saveBundle writes out/bundles/<date>.json", () => {
  const out = tmp();
  const { jsonPath } = saveBundle(bundle, { outDir: out });
  assert.equal(jsonPath, path.join(out, "bundles", "2026-11-25.json"));
  assert.deepEqual(JSON.parse(readFileSync(jsonPath, "utf8")), bundle);
});

test("saveDayCard writes md + json and returns markdown", () => {
  const out = tmp();
  const r = saveDayCard(bundle, "did abc1234 and https://github.com/foo", { outDir: out });
  assert.equal(r.mdPath, path.join(out, "daily", "2026-11-25.md"));
  assert.equal(readFileSync(r.mdPath, "utf8"), r.markdown);
  const card = JSON.parse(readFileSync(r.jsonPath, "utf8"));
  assert.equal(card.date, "2026-11-25");
  assert.equal(card.markdown, r.markdown);
  assert.deepEqual(card.bundle, bundle);
});

test("saveDayCard rejects invalid bundle without writing", () => {
  const out = tmp();
  assert.throws(
    () => saveDayCard({ ...bundle, date: "../../etc" }, "s", { outDir: out }),
    /validation failed/,
  );
  assert.equal(existsSync(path.join(out, "daily")), false);
});

test("saveDayCard rejects summary with URL not in bundle", () => {
  const out = tmp();
  assert.throws(
    () => saveDayCard(bundle, "see https://evil.example/x", { outDir: out }),
    /validation failed.*evil\.example/,
  );
});

test("saveDayCard rejects summary with hash not in bundle", () => {
  const out = tmp();
  assert.throws(
    () => saveDayCard(bundle, "commit deadbe1f00", { outDir: out }),
    /validation failed.*deadbe1f00/,
  );
});

test("saveDayCard allows abbreviated bundle hash", () => {
  const out = tmp();
  const full: DayBundle = {
    ...bundle,
    git: [{ repo: "/r", commits: [{ hash: "abc1234def5678", subject: "x" }] }],
  };
  assert.doesNotThrow(() => saveDayCard(full, "commit abc1234", { outDir: out }));
});
