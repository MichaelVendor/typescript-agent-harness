import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bindReview,
  clearReviewBinding,
  fetchReviewSnapshot,
  loadReviewBinding,
  parseGithubPrRef,
  reviewBindingPath,
  type ReviewBinding,
} from "../dist/serve/review.js";

const binding = (partial?: Partial<ReviewBinding>): ReviewBinding => ({
  provider: "github",
  owner: "acme",
  repo: "app",
  number: 42,
  url: "https://github.com/acme/app/pull/42",
  boundAt: 1_700_000_000_000,
  ...partial,
});

test("parseGithubPrRef: GitHub pull URL", () => {
  assert.deepEqual(parseGithubPrRef("https://github.com/foo/bar/pull/9"), {
    owner: "foo",
    repo: "bar",
    number: 9,
  });
  assert.deepEqual(parseGithubPrRef("http://github.com/foo/bar/pull/9/"), {
    owner: "foo",
    repo: "bar",
    number: 9,
  });
});

test("parseGithubPrRef: owner/repo#number", () => {
  assert.deepEqual(parseGithubPrRef("foo/bar#12"), { owner: "foo", repo: "bar", number: 12 });
});

test("parseGithubPrRef: rejects garbage", () => {
  assert.throws(() => parseGithubPrRef("not-a-pr"), /invalid github pr/i);
});

test("bind/load/clear use .tah/review-binding.json", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-review-"));
  const file = reviewBindingPath(cwd);
  assert.equal(file, path.join(cwd, ".tah", "review-binding.json"));

  bindReview(cwd, binding());
  assert.ok(existsSync(file));
  assert.deepEqual(loadReviewBinding(cwd), binding());
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), binding());

  clearReviewBinding(cwd);
  assert.ok(!existsSync(file));
  assert.equal(loadReviewBinding(cwd), null);

  rmSync(cwd, { recursive: true, force: true });
});

test("fetchReviewSnapshot: mock returns files without network", async () => {
  const b = binding();
  const mock = {
    ...b,
    state: "open",
    body: "fix bug",
    files: [{ path: "src/a.ts", status: "modified" }],
    diffPreview: "@@",
  };
  const snap = await fetchReviewSnapshot(b, { mock });
  assert.equal(snap.state, "open");
  assert.deepEqual(snap.files, mock.files);
  assert.equal(snap.owner, "acme");
});

test("fetchReviewSnapshot: requires mock or token", async () => {
  await assert.rejects(fetchReviewSnapshot(binding(), {}), /mock|github|connect/i);
});