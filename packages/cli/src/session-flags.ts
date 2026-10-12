import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SessionFlag = "pinned" | "archived";

type Flags = Record<SessionFlag, string[]>;

/** Pinned / archived session ids under `<cwd>/.tah/session-flags.json` (serve sidebar only). */
export function flagsPath(cwd: string): string {
  return path.join(path.resolve(cwd), ".tah", "session-flags.json");
}

export function loadSessionFlags(cwd: string): Flags {
  const out: Flags = { pinned: [], archived: [] };
  const file = flagsPath(cwd);
  if (!existsSync(file)) return out;
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Partial<Record<SessionFlag, unknown>>;
    for (const flag of ["pinned", "archived"] as const) {
      const ids = raw?.[flag];
      if (Array.isArray(ids)) out[flag] = ids.filter((id): id is string => typeof id === "string");
    }
  } catch {
    // unreadable file: treat as no flags
  }
  return out;
}

/** Archiving a session also unpins it. */
export function setSessionFlag(cwd: string, id: string, flag: SessionFlag, on: boolean): void {
  const all = loadSessionFlags(cwd);
  const without = (ids: string[]) => ids.filter((x) => x !== id);
  all[flag] = on ? [...without(all[flag]), id] : without(all[flag]);
  if (flag === "archived" && on) all.pinned = without(all.pinned);
  const file = flagsPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
}
