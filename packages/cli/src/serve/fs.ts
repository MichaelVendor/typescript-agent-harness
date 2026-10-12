import { existsSync, mkdirSync, readdirSync } from "node:fs";
import path from "node:path";
import type { DirListing } from "./protocol.js";

/** Sub-folder names of `dir` (default `home`) for the folder picker; never files or contents. */
export function listDirs(dir: string | undefined, home: string): DirListing {
  const target = path.resolve(dir || home);
  let entries;
  try {
    entries = readdirSync(target, { withFileTypes: true });
  } catch {
    throw new Error(`not a readable folder: ${target}`);
  }
  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((x, y) => x.localeCompare(y));
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, dirs };
}

export function makeDir(parent: string, name: string): string {
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) throw new Error(`invalid folder name: "${name}"`);
  const target = path.join(path.resolve(parent), name);
  if (existsSync(target)) throw new Error(`already exists: ${target}`);
  mkdirSync(target);
  return target;
}
