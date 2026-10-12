import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Folders shown in the `tah serve` sidebar, under `<home>/.tah/workspaces.json`. */
export function workspacesPath(home: string): string {
  return path.join(home, ".tah", "workspaces.json");
}

export function loadWorkspaces(home: string): string[] {
  const file = workspacesPath(home);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { workspaces?: unknown };
    if (!Array.isArray(raw?.workspaces)) return [];
    const dirs = raw.workspaces.filter((d): d is string => typeof d === "string").map((d) => path.resolve(d));
    return [...new Set(dirs)];
  } catch {
    // unreadable file: treat as no folders
    return [];
  }
}

function save(home: string, dirs: string[]): string[] {
  const file = workspacesPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ workspaces: dirs }, null, 2)}\n`);
  return dirs;
}

export function addWorkspace(home: string, dir: string): string[] {
  const dirs = loadWorkspaces(home);
  const target = path.resolve(dir);
  return dirs.includes(target) ? dirs : save(home, [...dirs, target]);
}

export function removeWorkspace(home: string, dir: string): string[] {
  const target = path.resolve(dir);
  return save(home, loadWorkspaces(home).filter((d) => d !== target));
}
