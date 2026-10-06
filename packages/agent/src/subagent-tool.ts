import { SESSION } from "./plugin.js";
import type { Tool } from "@typescript-agent-harness/tools";

/**
 * Subagent is just another Tool. The child Session shares the Runtime;
 * recursion is avoided by not exposing this tool on nested runs if you
 * omit it from the parent allowlist — or by the model simply not calling it.
 */
export function subagentTool(): Tool<{ task: string }, unknown> {
  return {
    name: "run_subagent",
    description: "Run a child agent session on a subtask and return its final text.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Instructions for the child agent" },
      },
      required: ["task"],
      additionalProperties: false,
    },
    async execute(input, ctx) {
      const sessions = ctx.runtime.get(SESSION);
      const child = await sessions.create();
      const result = await child.run(input.task);
      return {
        sessionId: child.id,
        text: result.text,
        finishReason: result.finishReason,
      };
    },
  };
}
