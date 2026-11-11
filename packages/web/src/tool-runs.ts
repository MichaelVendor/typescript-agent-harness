import type { Entry } from "./state";

export type ToolEntry = Extract<Entry, { kind: "tool" }>;

export type EntryBlock =
  | { kind: "row"; entry: Exclude<Entry, { kind: "tool" }> }
  | { kind: "tools"; tools: ToolEntry[] };

/** Consecutive tool entries become one block (Claude-style step group). */
export function groupToolRuns(entries: readonly Entry[]): EntryBlock[] {
  const out: EntryBlock[] = [];
  let i = 0;
  while (i < entries.length) {
    const entry = entries[i]!;
    if (entry.kind !== "tool") {
      out.push({ kind: "row", entry });
      i += 1;
      continue;
    }
    const tools: ToolEntry[] = [];
    while (i < entries.length) {
      const next = entries[i]!;
      if (next.kind !== "tool") break;
      tools.push(next);
      i += 1;
    }
    out.push({ kind: "tools", tools });
  }
  return out;
}
