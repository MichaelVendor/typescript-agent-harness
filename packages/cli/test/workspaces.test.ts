import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readSavedSessions } from "../dist/runtime.js";
import {
  addWorkspace,
  loadRecent,
  loadWorkspaceEntries,
  loadWorkspaces,
  removeWorkspace,
  workspacesPath,
} from "../dist/workspaces.js";

test("workspaces.json: add dedupes by resolved path, remove keeps order", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ws-home-"));
  assert.deepEqual(loadWorkspaces(home), []);
  addWorkspace(home, "/tmp/a");
  addWorkspace(home, "/tmp/b/");
  addWorkspace(home, "/tmp/x/../a");
  assert.deepEqual(loadWorkspaces(home), ["/tmp/a", "/tmp/b"]);
  assert.match(readFileSync(workspacesPath(home), "utf8"), /"workspaces"/);
  assert.deepEqual(removeWorkspace(home, "/tmp/a"), ["/tmp/b"]);
  assert.deepEqual(loadWorkspaces(home), ["/tmp/b"]);
});

test("workspaces.json: removed folders become recent (newest first, capped); adding one takes it out", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ws-home-"));
  for (let i = 0; i < 12; i++) addWorkspace(home, `/tmp/r${i}`);
  for (let i = 0; i < 12; i++) removeWorkspace(home, `/tmp/r${i}`);
  assert.deepEqual(loadRecent(home), Array.from({ length: 10 }, (_, i) => `/tmp/r${11 - i}`));
  addWorkspace(home, "/tmp/r5");
  assert.equal(loadRecent(home).includes("/tmp/r5"), false);
  assert.deepEqual(loadWorkspaces(home), ["/tmp/r5"]);
  removeWorkspace(home, "/tmp/r5");
  assert.equal(loadRecent(home)[0], "/tmp/r5");
});

test("workspaces.json: loads string paths and object entries with metadata", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ws-home-"));
  mkdirSync(path.join(home, ".tah"));
  writeFileSync(
    workspacesPath(home),
    JSON.stringify({
      workspaces: ["/tmp/a", { path: "/tmp/b", kind: "worktree", parent: "/repo/root" }],
    }),
  );
  assert.deepEqual(loadWorkspaces(home), ["/tmp/a", "/tmp/b"]);
  assert.deepEqual(loadWorkspaceEntries(home), [
    { path: "/tmp/a" },
    { path: "/tmp/b", kind: "worktree", parent: path.resolve("/repo/root") },
  ]);
});

test("workspaces.json: addWorkspace with worktree metadata persists object", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ws-home-"));
  const wt = "/tmp/wt-feat";
  addWorkspace(home, wt, { kind: "worktree", parent: "/repo" });
  const raw = JSON.parse(readFileSync(workspacesPath(home), "utf8")) as { workspaces: unknown[] };
  assert.deepEqual(raw.workspaces, [{ path: wt, kind: "worktree", parent: path.resolve("/repo") }]);
  assert.deepEqual(loadWorkspaceEntries(home), [{ path: wt, kind: "worktree", parent: path.resolve("/repo") }]);
});

test("workspaces.json: corrupt or wrong-shaped file reads as empty", () => {
  const home = mkdtempSync(path.join(tmpdir(), "tah-ws-home-"));
  mkdirSync(path.join(home, ".tah"));
  writeFileSync(workspacesPath(home), "{");
  assert.deepEqual(loadWorkspaces(home), []);
  writeFileSync(workspacesPath(home), JSON.stringify({ workspaces: ["/ok", 3, null] }));
  assert.deepEqual(loadWorkspaces(home), ["/ok"]);
});

test("readSavedSessions: [] without a db", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ws-empty-"));
  assert.deepEqual(await readSavedSessions(cwd), []);
});
