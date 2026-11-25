import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectGit } from "./collect-git.ts";
import { dayRange } from "./day-range.ts";

test("dayRange respects timezone", () => {
  const { start, end } = dayRange("2026-11-25", "Asia/Shanghai");
  assert.equal(start.toISOString(), "2026-11-24T16:00:00.000Z");
  assert.equal(end.toISOString(), "2026-11-25T16:00:00.000Z");
});

test("collectGit on a nonexistent repo yields a gap, not a throw", () => {
  const r = collectGit(["/nonexistent/repo-xyz"], "2026-11-25", "Asia/Shanghai");
  assert.deepEqual(r.git, []);
  assert.equal(r.gaps.length, 1);
  assert.match(r.gaps[0]!, /git:.*nonexistent/);
});

test("collectGit on the current repo does not throw", () => {
  const repo = path.resolve(import.meta.dirname, "../../..");
  const r = collectGit([repo], "2026-11-25", "Asia/Shanghai");
  assert.ok(Array.isArray(r.git));
  assert.ok(Array.isArray(r.gaps));
});

test("collectGit returns commits within the local day only", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wl-git-"));
  const git = (args: string[], date?: string) =>
    execFileSync("git", ["-C", dir, ...args], {
      env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) },
      stdio: "pipe",
    });
  git(["init", "-q"]);
  git(["config", "user.email", "t@example.com"]);
  git(["config", "user.name", "t"]);
  git(["config", "commit.gpgsign", "false"]);
  writeFileSync(path.join(dir, "a.txt"), "1");
  git(["add", "."]);
  git(["commit", "-q", "-m", "inside day"], "2026-11-25T10:00:00+08:00");
  writeFileSync(path.join(dir, "a.txt"), "2");
  git(["commit", "-q", "-am", "next day"], "2026-11-26T01:00:00+08:00");

  const r = collectGit([dir], "2026-11-25", "Asia/Shanghai");
  assert.equal(r.git.length, 1);
  assert.equal(r.git[0]!.repo, dir);
  assert.deepEqual(r.git[0]!.commits.map((c) => c.subject), ["inside day"]);
  assert.match(r.git[0]!.commits[0]!.hash, /^[0-9a-f]{40}$/);
});
