import test from "node:test";
import assert from "node:assert/strict";
import { composeBundle } from "./compose.ts";

test("merges three sources and dedupes gaps", () => {
  const b = composeBundle({
    date: "2026-11-25",
    git: [{ repo: "/r", commits: [{ hash: "abc1234", subject: "feat: x" }] }],
    cursor: [{ workspace: "w", note: "n", evidence: "e.jsonl" }],
    browser: [{ url: "https://github.com/foo", title: "foo" }],
    gaps: ["browser: partial", "browser: partial", "git: x"],
  });
  assert.equal(b.date, "2026-11-25");
  assert.equal(b.git.length, 1);
  assert.deepEqual(b.gaps, ["browser: partial", "git: x"]);
});

test("missing sources default to empty", () => {
  const b = composeBundle({ date: "2026-11-25" });
  assert.deepEqual([b.git, b.cursor, b.browser, b.gaps], [[], [], [], []]);
});

test("throws on invalid bundle", () => {
  assert.throws(() => composeBundle({ date: "bad" }), /validation failed/);
});
