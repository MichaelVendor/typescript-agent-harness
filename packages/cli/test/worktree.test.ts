import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  addWorktree,
  isGitRepo,
  removeWorktree,
  worktreePath,
} from "../dist/serve/worktree.js";

function initRepo(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-wt-repo-"));
  execFileSync("git", ["init"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(path.join(dir, "README"), "x\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
  return dir;
}

test("isGitRepo: false outside a repository", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-wt-nogit-"));
  assert.equal(isGitRepo(dir), false);
});

test("isGitRepo: true in initialized repo", () => {
  const repo = initRepo();
  assert.equal(isGitRepo(repo), true);
});

test("addWorktree: throws when cwd is not a git repo", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "tah-wt-nogit-"));
  assert.throws(() => addWorktree(dir, "feat"), /git/i);
});

test("addWorktree: throws on invalid name", () => {
  const repo = initRepo();
  assert.throws(() => addWorktree(repo, ""), /invalid/i);
  assert.throws(() => addWorktree(repo, "-bad"), /invalid/i);
  assert.throws(() => addWorktree(repo, "has space"), /invalid/i);
});

test("worktreePath resolves under .tah/worktrees", () => {
  const repo = "/repo/root";
  assert.equal(worktreePath(repo, "my-task"), path.join(repo, ".tah", "worktrees", "my-task"));
});

test("addWorktree: creates directory and tah branch", () => {
  const repo = initRepo();
  const name = "parallel-a";
  const { path: wtPath, branch } = addWorktree(repo, name);
  assert.equal(branch, `tah/${name}`);
  assert.equal(wtPath, worktreePath(repo, name));
  assert.equal(existsSync(wtPath), true);
  const listed = execFileSync("git", ["worktree", "list", "--porcelain"], { cwd: repo, encoding: "utf8" });
  assert.match(listed, new RegExp(wtPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const branches = execFileSync("git", ["branch", "--list", branch], { cwd: repo, encoding: "utf8" });
  assert.match(branches, new RegExp(branch));
  removeWorktree(repo, name);
});

test("removeWorktree: cleans worktree and branch", () => {
  const repo = initRepo();
  const name = "cleanup-b";
  const { path: wtPath, branch } = addWorktree(repo, name);
  assert.equal(existsSync(wtPath), true);
  removeWorktree(repo, name);
  assert.equal(existsSync(wtPath), false);
  const branches = execFileSync("git", ["branch", "--list", branch], { cwd: repo, encoding: "utf8" }).trim();
  assert.equal(branches, "");
});

test("removeWorktree: best-effort when never added", () => {
  const repo = initRepo();
  assert.doesNotThrow(() => removeWorktree(repo, "never-existed"));
});