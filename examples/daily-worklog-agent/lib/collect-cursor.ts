import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import type { DayBundle } from "./schema.ts";
import { dayRange } from "./day-range.ts";

function walkJsonl(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJsonl(full));
    else if (entry.name.endsWith(".jsonl")) out.push(full);
  }
  return out;
}

export function collectCursor(
  projectsRoot: string,
  date: string,
  timezone: string,
): { cursor: DayBundle["cursor"]; gaps: string[] } {
  if (!existsSync(projectsRoot)) {
    return { cursor: [], gaps: [`cursor: projects root not found: ${projectsRoot}`] };
  }
  const { start, end } = dayRange(date, timezone);
  const cursor: DayBundle["cursor"] = [];

  for (const proj of readdirSync(projectsRoot, { withFileTypes: true })) {
    if (!proj.isDirectory()) continue;
    const tdir = path.join(projectsRoot, proj.name, "agent-transcripts");
    if (!existsSync(tdir)) continue;
    for (const file of walkJsonl(tdir).sort()) {
      const m = statSync(file).mtime;
      if (m >= start && m < end) {
        cursor.push({ workspace: proj.name, note: path.basename(file), evidence: file });
      }
    }
  }
  const gaps = cursor.length === 0 ? [`cursor: no transcripts modified on ${date}`] : [];
  return { cursor, gaps };
}
