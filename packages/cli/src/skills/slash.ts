import { loadSkillBody } from "./load.js";
import { listSkillResources } from "./resources.js";
import { renderSkillContent } from "./render.js";
import { extractSlashSkills } from "./slash-names.js";
import type { SkillSummary } from "./types.js";

export { extractSlashSkills };

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
    try {
      const { body } = loadSkillBody(summary);
      const resources = listSkillResources(summary.dir, body);
      parts.push(renderSkillContent(summary, body, resources));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      parts.push(`<skill_content name="${name}">\nError: ${message}\n</skill_content>`);
    }
  }
  return { displayText: text, modelSuffix: parts.join("\n\n") };
}

/** Drop a model-only skill or MCP prompt payload so transcripts keep the user's original text. */
export function stripSkillInjection(text: string): string {
  let idx = -1;
  for (const marker of ["\n\n<skill_content ", "\n\n<mcp_prompt "]) {
    const at = text.indexOf(marker);
    if (at >= 0 && (idx < 0 || at < idx)) idx = at;
  }
  return idx < 0 ? text : text.slice(0, idx);
}
