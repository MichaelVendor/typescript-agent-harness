import { execFileSync } from "node:child_process";
import path from "node:path";

const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;

export function isGitRepo(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--git-dir"], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function worktreePath(repoRoot: string, name: string): string {
  return path.join(path.resolve(repoRoot), ".tah", "worktrees", name);
}

function assertValidName(name: string): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid worktree name: "${name}"`);
}

/** Creates `<repo>/.tah/worktrees/<name>` on branch `tah/<name>`. Throws if not a git repo or name invalid. */
export function addWorktree(repoRoot: string, name: string): { path: string; branch: string } {
  const root = path.resolve(repoRoot);
  if (!isGitRepo(root)) throw new Error(`not a git repository: ${root}`);
  assertValidName(name);
  const wtPath = worktreePath(root, name);
  const branch = `tah/${name}`;
  execFileSync("git", ["worktree", "add", "-b", branch, wtPath], { cwd: root, stdio: "inherit" });
  return { path: wtPath, branch };
}

/** Best-effort remove; ignores errors when `force` path was never added. */
export function removeWorktree(repoRoot: string, name: string): void {
  const root = path.resolve(repoRoot);
  const wtPath = worktreePath(root, name);
  const branch = `tah/${name}`;
  try {
    execFileSync("git", ["worktree", "remove", "--force", wtPath], { cwd: root, stdio: "ignore" });
  } catch {
    // never added or already removed
  }
  try {
    execFileSync("git", ["branch", "-D", branch], { cwd: root, stdio: "ignore" });
  } catch {
    // branch may not exist
  }
}