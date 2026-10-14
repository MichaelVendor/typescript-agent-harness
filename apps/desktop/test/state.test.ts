import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { readLastFolder, writeLastFolder } from "../dist/state.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "tah-desktop-"));
const file = (home: string) => path.join(home, ".tah", "desktop.json");

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
