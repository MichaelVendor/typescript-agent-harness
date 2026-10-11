import { loadSkillBody } from "./load.js";
import { listSkillResources } from "./resources.js";
import { renderSkillContent } from "./render.js";
import type { SkillSummary } from "./types.js";

const SLASH_RE = /(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g;

export function extractSlashSkills(text: string): { names: string[]; displayText: string } {
  const names = [...text.matchAll(new RegExp(SLASH_RE.source, "g"))].map((m) => m[1]!);
  return { names, displayText: text };
}

export function applySlashSkills(
  text: string,
  skills: SkillSummary[],
): { displayText: string; modelSuffix: string } {
  const byName = new Map(skills.map((s) => [s.name, s]));
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const name of extractSlashSkills(text).names) {
    if (seen.has(name)) continue;
    const summary = byName.get(name);
    if (!summary || !summary.userInvocable) continue;
    seen.add(name);
    const { body } = loadSkillBody(summary);
    const resources = listSkillResources(summary.dir, body);
    parts.push(renderSkillContent(summary, body, resources));
  }
  return { displayText: text, modelSuffix: parts.join("\n\n") };
}
