import { existsSync } from "node:fs";
import path from "node:path";
import { createJiti } from "jiti";
import { isProject } from "../project.js";

const FILES = ["suggestions.ts", "suggestions.mts", "suggestions.js", "suggestions.mjs"];
const MAX = 4;
const LABEL = 42;

export type Suggestion = { label: string; send: string; detail?: string };

let lastError = "";

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function note(message: string): void {
  if (message === lastError) return;
  lastError = message;
  console.error(`[tah] suggestions: ${message}`);
}

/** Reads the open project's `suggestions.ts`. Missing file or a non-project cwd yields nothing. */
export async function loadSuggestions(cwd: string): Promise<Suggestion[]> {
  if (!isProject(cwd)) return [];
  const file = FILES.map((name) => path.join(cwd, name)).find((candidate) => existsSync(candidate));
  if (!file) return [];
  const jiti = createJiti(path.join(cwd, "package.json"), { moduleCache: false } as never);
  let mod: unknown;
  try {
    mod = await jiti.import(file, { default: true });
  } catch (err) {
    note(err instanceof Error ? err.message : String(err));
    return [];
  }
  if (typeof mod !== "function") {
    note(`${path.basename(file)} must export default function suggestions(cwd)`);
    return [];
  }
  let raw: unknown;
  try {
    raw = await mod(cwd);
  } catch (err) {
    note(err instanceof Error ? err.message : String(err));
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const out: Suggestion[] = [];
  for (const row of raw) {
    if (out.length >= MAX) break;
    if (!row || typeof row !== "object") continue;
    const item = row as { label?: unknown; send?: unknown; detail?: unknown };
    const label = clip(item.label, LABEL);
    const send = typeof item.send === "string" ? item.send.trim() : "";
    if (!label || !send || send.length > 200) continue;
    const detail = clip(item.detail, 40);
    out.push(detail ? { label, send, detail } : { label, send });
  }
  lastError = "";
  return out;
}
