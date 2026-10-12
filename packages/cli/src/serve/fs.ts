import { type Dirent, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
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
  const isDir = (e: Dirent) => {
    if (e.isDirectory()) return true;
    if (!e.isSymbolicLink()) return false;
    try {
      return statSync(path.join(target, e.name)).isDirectory();
    } catch {
      return false;
    }
  };
  const dirs = entries
    .filter((e) => isDir(e) && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort((x, y) => x.localeCompare(y));
  const crumbs: DirListing["crumbs"] = [];
  for (let p = target; ; p = path.dirname(p)) {
    crumbs.unshift({ name: path.basename(p) || p, path: p });
    if (path.dirname(p) === p) break;
  }
  const parent = path.dirname(target);
  return { path: target, parent: parent === target ? null : parent, dirs, crumbs };
}

export function makeDir(parent: string, name: string): string {
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) throw new Error(`invalid folder name: "${name}"`);
  const target = path.join(path.resolve(parent), name);
  if (existsSync(target)) throw new Error(`already exists: ${target}`);
  mkdirSync(target);
  return target;
}
