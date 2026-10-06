import type { Plugin } from "@typescript-agent-harness/core";
import { TOOLS } from "@typescript-agent-harness/tools";
import { toolsFromMcp } from "./adapt.js";
import type { McpBackend } from "./types.js";

export type McpPluginOptions = {
  backend: McpBackend;
};

export function mcpPlugin(options: McpPluginOptions): Plugin {
  const { backend } = options;
  return {
    name: "mcp",
    async setup(ctx) {
      const tools = ctx.get(TOOLS);
      const infos = await backend.listTools();
      for (const tool of toolsFromMcp(backend, infos)) {
        tools.register(tool);
      }
    },
    async dispose() {
      await backend.close?.();
    },
  };
}
