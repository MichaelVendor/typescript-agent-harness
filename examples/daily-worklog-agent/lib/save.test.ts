import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle, saveBundle, saveDayCard } from "./save.ts";
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

const uuidPath =
  "/Users/u/.cursor/projects/p/agent-transcripts/06688cae-80de-4a35-b113-bf7c50f5fbd7/06688cae-80de-4a35-b113-bf7c50f5fbd7.jsonl";
const withCursor: DayBundle = {
  ...bundle,
  cursor: [{ workspace: "p", note: "bf7c50f5fbd7.jsonl", evidence: uuidPath }],
};

test("saveDayCard allows UUID fragments from cursor evidence", () => {
  const out = tmp();
  assert.doesNotThrow(() =>
    saveDayCard(withCursor, `cursor 06688cae and bf7c50f5fbd7 [${uuidPath}]`, { outDir: out }),
  );
});

test("saveDayCard still rejects random hex when cursor evidence exists", () => {
  assert.throws(
    () => saveDayCard(withCursor, "commit 1234abcd99", { outDir: tmp() }),
    /summary hash not in bundle: 1234abcd99/,
  );
});

test("saveDayCard rejects http:// URL not in bundle", () => {
  assert.throws(
    () => saveDayCard(bundle, "see http://localhost:9999/fake", { outDir: tmp() }),
    /summary url not in bundle: http:\/\/localhost:9999\/fake/,
  );
});

test("saveDayCard rejects URL that only shares a string prefix with a bundle URL", () => {
  assert.throws(
    () => saveDayCard(bundle, "https://github.com/foo-fabricated/pull/1", { outDir: tmp() }),
    /validation failed.*foo-fabricated/,
  );
});

test("saveDayCard rejects truncated URL prefix like https://g", () => {
  assert.throws(() => saveDayCard(bundle, "see https://g now", { outDir: tmp() }), /url not in bundle: https:\/\/g/);
});

test("saveDayCard rejects URL extended beyond a bundle URL", () => {
  assert.throws(
    () => saveDayCard(bundle, "https://github.com/foo/pull/1", { outDir: tmp() }),
    /validation failed/,
  );
});

test("saveDayCard allows exact bundle URL, trailing punctuation, and boundary prefix", () => {
  const b: DayBundle = { ...bundle, browser: [{ url: "https://github.com/foo/pull/1?x=1", title: "t" }] };
  assert.doesNotThrow(() => saveDayCard(b, "https://github.com/foo/pull/1?x=1.", { outDir: tmp() }));
  assert.doesNotThrow(() => saveDayCard(b, "https://github.com/foo/pull/1", { outDir: tmp() }));
  assert.doesNotThrow(() => saveDayCard(b, "https://github.com/foo", { outDir: tmp() }));
});

test("loadBundle returns saved bundle, null when missing or date malformed", () => {
  const out = tmp();
  assert.equal(loadBundle("2026-11-25", { outDir: out }), null);
  saveBundle(bundle, { outDir: out });
  assert.deepEqual(loadBundle("2026-11-25", { outDir: out }), bundle);
  assert.equal(loadBundle("../../etc", { outDir: out }), null);
});
