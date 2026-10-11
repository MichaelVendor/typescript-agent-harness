import type { Tool } from "@typescript-agent-harness/tools";
import { loadSkillBody } from "./load.js";
import { listSkillResources } from "./resources.js";
import { renderSkillContent } from "./render.js";
import type { SkillSummary } from "./types.js";

export function createSkillTool(skills: SkillSummary[]): Tool<{ name: string }, string> {
  const byName = new Map(skills.map((s) => [s.name, s]));
  return {
    name: "skill",
    description:
      "Load the full instructions for one catalog skill by name. Call this when a task matches an available skill. Do not reload a skill already loaded in this turn unless the user asks.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Kebab-case skill name from the catalog" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    async execute(input) {
      const name = input?.name ?? "";
      const summary = byName.get(name);
      if (!summary) return `Error: unknown skill: ${name}`;
      if (!summary.modelInvocable) return `Error: not model-invocable: ${name}`;
      try {
        const { body } = loadSkillBody(summary);
        const resources = listSkillResources(summary.dir, body);
        return renderSkillContent(summary, body, resources);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error: ${message}`;
      }
    },
  };
}
