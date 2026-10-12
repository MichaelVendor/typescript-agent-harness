import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RECENT_MAX = 10;

type Stored = { workspaces: string[]; recent: string[] };

/** Folders shown in the `tah serve` sidebar, under `<home>/.tah/workspaces.json`. */
export function workspacesPath(home: string): string {
  return path.join(home, ".tah", "workspaces.json");
}

function load(home: string): Stored {
  const file = workspacesPath(home);
  if (!existsSync(file)) return { workspaces: [], recent: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { workspaces?: unknown; recent?: unknown };
    const dirs = (v: unknown) =>
      Array.isArray(v) ? [...new Set(v.filter((d): d is string => typeof d === "string").map((d) => path.resolve(d)))] : [];
    return { workspaces: dirs(raw?.workspaces), recent: dirs(raw?.recent) };
  } catch {
    // unreadable file: treat as no folders
    return { workspaces: [], recent: [] };
  }
}

function save(home: string, stored: Stored): Stored {
  const file = workspacesPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stored, null, 2)}\n`);
  return stored;
}

export function loadWorkspaces(home: string): string[] {
  return load(home).workspaces;
}

/** Folders removed from the sidebar, newest first. */
export function loadRecent(home: string): string[] {
  return load(home).recent;
}

export function addWorkspace(home: string, dir: string): string[] {
  const stored = load(home);
  const target = path.resolve(dir);
  if (stored.workspaces.includes(target) && !stored.recent.includes(target)) return stored.workspaces;
  return save(home, {
    workspaces: stored.workspaces.includes(target) ? stored.workspaces : [...stored.workspaces, target],
    recent: stored.recent.filter((d) => d !== target),
  }).workspaces;
}

export function removeWorkspace(home: string, dir: string): string[] {
  const stored = load(home);
  const target = path.resolve(dir);
  return save(home, {
    workspaces: stored.workspaces.filter((d) => d !== target),
    recent: [target, ...stored.recent.filter((d) => d !== target)].slice(0, RECENT_MAX),
  }).workspaces;
}
