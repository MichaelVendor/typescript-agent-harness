import type { SkillSummary } from "./types.js";

export function buildSkillsCatalogSection(
  skills: SkillSummary[],
  opts?: { descriptionMaxLength?: number },
): string | undefined {
  const max = opts?.descriptionMaxLength ?? 500;
  const rows = skills
    .filter((s) => s.modelInvocable)
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => {
      const d = s.description.length > max ? s.description.slice(0, max) : s.description;
      return `- ${s.name}: ${d}`;
    });
  if (rows.length === 0) return undefined;
  return [
    "Available skills (progressive disclosure):",
    "Call the skill tool with { name } to load full instructions when a task matches.",
    "Do not reload a skill you already loaded in this turn unless the user asks.",
    "Skills:",
    ...rows,
  ].join("\n");
}
