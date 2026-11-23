import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RECENT_MAX = 10;

export type WorkspaceEntry = {
  path: string;
  kind?: "worktree";
  parent?: string;
};

type Stored = { workspaces: WorkspaceEntry[]; recent: string[] };

/** Folders shown in the `tah serve` sidebar, under `<home>/.tah/workspaces.json`. */
export function workspacesPath(home: string): string {
  return path.join(home, ".tah", "workspaces.json");
}

function parseEntry(raw: unknown): WorkspaceEntry | undefined {
  if (typeof raw === "string") return { path: path.resolve(raw) };
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as { path?: unknown; kind?: unknown; parent?: unknown };
  if (typeof o.path !== "string") return undefined;
  const entry: WorkspaceEntry = { path: path.resolve(o.path) };
  if (o.kind === "worktree") entry.kind = "worktree";
  if (typeof o.parent === "string") entry.parent = path.resolve(o.parent);
  return entry;
}

function parseList(v: unknown): WorkspaceEntry[] {
  if (!Array.isArray(v)) return [];
  const out: WorkspaceEntry[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const entry = parseEntry(raw);
    if (!entry || seen.has(entry.path)) continue;
    seen.add(entry.path);
    out.push(entry);
  }
  return out;
}

function serializeEntry(entry: WorkspaceEntry): string | WorkspaceEntry {
  if (entry.kind === "worktree" || entry.parent !== undefined) {
    return {
      path: entry.path,
      ...(entry.kind ? { kind: entry.kind } : {}),
      ...(entry.parent ? { parent: entry.parent } : {}),
    };
  }
  return entry.path;
}

function load(home: string): Stored {
  const file = workspacesPath(home);
  if (!existsSync(file)) return { workspaces: [], recent: [] };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { workspaces?: unknown; recent?: unknown };
    const recent = Array.isArray(raw?.recent)
      ? [...new Set(raw.recent.filter((d): d is string => typeof d === "string").map((d) => path.resolve(d)))]
      : [];
    return { workspaces: parseList(raw?.workspaces), recent };
  } catch {
    // unreadable file: treat as no folders
    return { workspaces: [], recent: [] };
  }
}

function save(home: string, stored: Stored): Stored {
  const file = workspacesPath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    `${JSON.stringify({ workspaces: stored.workspaces.map(serializeEntry), recent: stored.recent }, null, 2)}\n`,
  );
  return stored;
}

export function loadWorkspaces(home: string): string[] {
  return load(home).workspaces.map((e) => e.path);
}

export function loadWorkspaceEntries(home: string): WorkspaceEntry[] {
  return load(home).workspaces;
}

/** Folders removed from the sidebar, newest first. */
export function loadRecent(home: string): string[] {
  return load(home).recent;
}

export function addWorkspace(
  home: string,
  dir: string,
  meta?: { kind?: "worktree"; parent?: string },
): string[] {
  const stored = load(home);
  const target = path.resolve(dir);
  const idx = stored.workspaces.findIndex((e) => e.path === target);
  const inList = idx >= 0;
  const hasMeta = meta?.kind === "worktree" || meta?.parent !== undefined;

  if (inList && !stored.recent.includes(target) && !hasMeta) {
    return stored.workspaces.map((e) => e.path);
  }

  let workspaces: WorkspaceEntry[];
  if (inList && hasMeta) {
    workspaces = [...stored.workspaces];
    workspaces[idx] = {
      path: target,
      ...(meta?.kind === "worktree" ? { kind: "worktree" } : {}),
      ...(meta?.parent ? { parent: path.resolve(meta.parent) } : {}),
    };
  } else if (!inList) {
    const entry: WorkspaceEntry = { path: target };
    if (meta?.kind === "worktree") entry.kind = "worktree";
    if (meta?.parent) entry.parent = path.resolve(meta.parent);
    workspaces = [...stored.workspaces, entry];
  } else {
    workspaces = stored.workspaces;
  }

  return save(home, {
    workspaces,
    recent: stored.recent.filter((d) => d !== target),
  }).workspaces.map((e) => e.path);
}

export function removeWorkspace(home: string, dir: string): string[] {
  const stored = load(home);
  const target = path.resolve(dir);
  return save(home, {
    workspaces: stored.workspaces.filter((e) => e.path !== target),
    recent: [target, ...stored.recent.filter((d) => d !== target)].slice(0, RECENT_MAX),
  }).workspaces.map((e) => e.path);
}