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
  parseGitlabMrRef,
  parseReviewRef,
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

test("parseGitlabMrRef: merge request URL", () => {
  assert.deepEqual(parseGitlabMrRef("https://gitlab.com/acme/app/-/merge_requests/7"), {
    owner: "acme",
    repo: "app",
    number: 7,
  });
  assert.deepEqual(parseGitlabMrRef("https://gitlab.com/group/sub/proj/-/merge_requests/3/"), {
    owner: "group/sub",
    repo: "proj",
    number: 3,
  });
  assert.deepEqual(parseGitlabMrRef("https://gitlab.example.com/acme/app/-/merge_requests/2"), {
    owner: "acme",
    repo: "app",
    number: 2,
    host: "https://gitlab.example.com",
  });
});

test("parseGitlabMrRef: namespace/project!iid", () => {
  assert.deepEqual(parseGitlabMrRef("group/sub/proj!11"), {
    owner: "group/sub",
    repo: "proj",
    number: 11,
  });
});

test("parseGitlabMrRef: rejects garbage", () => {
  assert.throws(() => parseGitlabMrRef("not-an-mr"), /invalid gitlab mr/i);
});

test("parseReviewRef: github before gitlab", () => {
  assert.deepEqual(parseReviewRef("foo/bar#1"), { provider: "github", owner: "foo", repo: "bar", number: 1 });
  assert.deepEqual(parseReviewRef("acme/app!9"), { provider: "gitlab", owner: "acme", repo: "app", number: 9 });
});

test("loadReviewBinding: accepts gitlab binding with host", () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-review-gl-"));
  const gl: ReviewBinding = {
    provider: "gitlab",
    owner: "g",
    repo: "p",
    number: 1,
    url: "https://gitlab.com/g/p/-/merge_requests/1",
    boundAt: 2,
    host: "https://gitlab.example.com",
  };
  bindReview(cwd, gl);
  assert.deepEqual(loadReviewBinding(cwd), gl);
  rmSync(cwd, { recursive: true, force: true });
});

test("fetchReviewSnapshot: gitlab mock fetch", async () => {
  const b: ReviewBinding = {
    provider: "gitlab",
    owner: "acme",
    repo: "app",
    number: 5,
    url: "https://gitlab.com/acme/app/-/merge_requests/5",
    boundAt: 1,
  };
  const calls: string[] = [];
  const mockFetch: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    if (url.endsWith("/changes")) {
      return new Response(
        JSON.stringify({
          changes: [
            { new_path: "src/a.ts", diff: "@@ chunk", new_file: true },
            { old_path: "b.ts", new_path: "b.ts", diff: "@@ b", deleted_file: false },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({
        title: "Fix things",
        description: "details",
        state: "opened",
        web_url: "https://gitlab.com/acme/app/-/merge_requests/5",
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  const snap = await fetchReviewSnapshot(b, { token: "glpat-test", fetch: mockFetch });
  assert.equal(snap.title, "Fix things");
  assert.equal(snap.state, "opened");
  assert.deepEqual(snap.files, [
    { path: "src/a.ts", status: "added" },
    { path: "b.ts", status: "modified" },
  ]);
  assert.match(snap.diffPreview ?? "", /@@ chunk/);
  assert.equal(calls.length, 2);
  assert.match(calls[0]!, /projects\/acme%2Fapp\/merge_requests\/5$/);
  assert.match(calls[1]!, /\/changes$/);
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
  await assert.rejects(fetchReviewSnapshot(binding(), {}), /mock|github|gitlab|connect/i);
});