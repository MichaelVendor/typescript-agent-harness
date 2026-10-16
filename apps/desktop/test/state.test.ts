import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { displayPath, listProjects, readLastFolder, writeLastFolder } from "../dist/state.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "tah-desktop-"));
const file = (home: string) => path.join(home, ".tah", "desktop.json");
const workspaces = (home: string, dirs: string[]) => {
  mkdirSync(path.join(home, ".tah"), { recursive: true });
  writeFileSync(path.join(home, ".tah", "workspaces.json"), JSON.stringify({ workspaces: dirs, recent: [] }));
};

test("no desktop.json gives undefined", () => {
  assert.equal(readLastFolder(tmp()), undefined);
});

test("reads back the folder it wrote", () => {
  const home = tmp();
  const folder = tmp();
  writeLastFolder(home, folder);
  assert.equal(readLastFolder(home), folder);
});

test("a deleted folder gives undefined", () => {
  const home = tmp();
  const folder = tmp();
  writeLastFolder(home, folder);
  rmSync(folder, { recursive: true });
  assert.equal(readLastFolder(home), undefined);
});

test("a file instead of a folder gives undefined", () => {
  const home = tmp();
  const notDir = path.join(tmp(), "a.txt");
  writeFileSync(notDir, "x");
  writeLastFolder(home, notDir);
  assert.equal(readLastFolder(home), undefined);
});

test("broken JSON gives undefined", () => {
  const home = tmp();
  mkdirSync(path.join(home, ".tah"));
  writeFileSync(file(home), "{");
  assert.equal(readLastFolder(home), undefined);
});

test("listProjects reads workspaces.json and marks last / missing", () => {
  const home = tmp();
  const a = tmp();
  const gone = path.join(tmp(), "removed");
  mkdirSync(gone);
  workspaces(home, [a, gone]);
  rmSync(gone, { recursive: true });
  writeLastFolder(home, a);
  const list = listProjects(home);
  assert.deepEqual(
    list.map((p) => ({ path: p.path, missing: p.missing, last: p.last, name: p.name })),
    [
      { path: a, missing: false, last: true, name: path.basename(a) },
      { path: gone, missing: true, last: false, name: "removed" },
    ],
  );
  assert.equal(list[0]?.displayPath, displayPath(home, a));
});

test("listProjects includes lastFolder even when it is not in workspaces.json", () => {
  const home = tmp();
  const only = tmp();
  writeLastFolder(home, only);
  const list = listProjects(home);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.path, only);
  assert.equal(list[0]?.last, true);
});

test("displayPath shortens $HOME", () => {
  assert.equal(displayPath("/Users/me", "/Users/me"), "~");
  assert.equal(displayPath("/Users/me", "/Users/me/Desktop/x"), "~/Desktop/x");
  assert.equal(displayPath("/Users/me", "/tmp/x"), "/tmp/x");
});
