import type { SkillSummary } from "./types.js";

export function renderSkillContent(
  summary: SkillSummary,
  body: string,
  resources: Array<{ path: string }>,
): string {
  const resourceLines = resources.map((r) => `- ${r.path}`).join("\n");
  const resourcesBlock = [
    "<skill_resources>",
    `resourceBase: ${summary.dir}`,
    resourceLines,
    "</skill_resources>",
  ]
    .filter((line) => line !== "")
    .join("\n");

  return [
    `<skill_content name="${summary.name}">`,
    resourcesBlock,
    "<skill_instructions>",
    body,
    "</skill_instructions>",
    "</skill_content>",
  ].join("\n");
}
