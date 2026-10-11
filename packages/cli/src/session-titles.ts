import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Custom session titles under `<cwd>/.tah/session-titles.json` (CLI / serve only). */
export function titlesPath(cwd: string): string {
  return path.join(path.resolve(cwd), ".tah", "session-titles.json");
}

export function loadSessionTitles(cwd: string): Record<string, string> {
  const file = titlesPath(cwd);
  if (!existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [id, title] of Object.entries(raw)) {
      if (typeof title === "string" && title.trim()) out[id] = title.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function setSessionTitle(cwd: string, id: string, title: string): string | undefined {
  const trimmed = title.replace(/\s+/g, " ").trim();
  const file = titlesPath(cwd);
  mkdirSync(path.dirname(file), { recursive: true });
  const all = loadSessionTitles(cwd);
  if (!trimmed) {
    delete all[id];
    writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
    return undefined;
  }
  const clipped = trimmed.length > 80 ? `${trimmed.slice(0, 80)}…` : trimmed;
  all[id] = clipped;
  writeFileSync(file, `${JSON.stringify(all, null, 2)}\n`);
  return clipped;
}
