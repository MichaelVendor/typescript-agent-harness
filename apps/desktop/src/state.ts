import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const desktopFile = (home: string) => path.join(home, ".tah", "desktop.json");
const workspacesFile = (home: string) => path.join(home, ".tah", "workspaces.json");

export type ProjectEntry = {
  path: string;
  /** Path with `$HOME` shown as `~`. */
  displayPath: string;
  name: string;
  /** True when the folder is gone or is not a directory. */
  missing: boolean;
  /** True when this is `lastFolder` in desktop.json (even if missing). */
  last: boolean;
};

/** The folder the app had open last time, if it still exists. */
export function readLastFolder(home: string): string | undefined {
  const last = readLastFolderRaw(home);
  if (!last || !existsSync(last) || !statSync(last).isDirectory()) return undefined;
  return last;
}

/** Path stored as last folder, whether or not it still exists. */
export function readLastFolderRaw(home: string): string | undefined {
  try {
    const folder = (JSON.parse(readFileSync(desktopFile(home), "utf8")) as { lastFolder?: unknown }).lastFolder;
    return typeof folder === "string" && folder ? path.resolve(folder) : undefined;
  } catch {
    return undefined;
  }
}

export function writeLastFolder(home: string, folder: string): void {
  mkdirSync(path.dirname(desktopFile(home)), { recursive: true });
  writeFileSync(desktopFile(home), `${JSON.stringify({ lastFolder: path.resolve(folder) }, null, 2)}\n`);
}

/** Sidebar folders from `~/.tah/workspaces.json` (same file as `tah serve`). */
export function listProjects(home: string): ProjectEntry[] {
  const last = readLastFolderRaw(home);
  const dirs = loadWorkspaceDirs(home);
  const seen = new Set<string>();
  const out: ProjectEntry[] = [];
  for (const dir of dirs) {
    const resolved = path.resolve(dir);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push(entry(home, resolved, last));
  }
  if (last && !seen.has(last)) out.unshift(entry(home, last, last));
  return out;
}

function entry(home: string, dir: string, last: string | undefined): ProjectEntry {
  const missing = !existsSync(dir) || !statSync(dir).isDirectory();
  return {
    path: dir,
    displayPath: displayPath(home, dir),
    name: path.basename(dir) || dir,
    missing,
    last: last === dir,
  };
}

/** Show `$HOME` as `~` for the welcome list. */
export function displayPath(home: string, folder: string): string {
  const root = path.resolve(home);
  const dir = path.resolve(folder);
  if (dir === root) return "~";
  if (dir.startsWith(root + path.sep)) return "~" + dir.slice(root.length);
  return dir;
}

function loadWorkspaceDirs(home: string): string[] {
  try {
    const raw = JSON.parse(readFileSync(workspacesFile(home), "utf8")) as { workspaces?: unknown };
    if (!Array.isArray(raw?.workspaces)) return [];
    return raw.workspaces.filter((d): d is string => typeof d === "string" && d.length > 0);
  } catch {
    return [];
  }
}
