import { readFileSync } from "node:fs";
import { parseSkillMarkdown } from "./parse.js";
import type { SkillSummary } from "./types.js";

export function loadSkillBody(summary: SkillSummary): { body: string } {
  const raw = readFileSync(summary.skillFile, "utf8");
  const parsed = parseSkillMarkdown(raw, summary.name);
  if (!parsed.ok) {
    throw new Error(parsed.warning);
  }
  return { body: parsed.body };
}
