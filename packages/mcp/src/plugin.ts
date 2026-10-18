import type { Plugin } from "@typescript-agent-harness/core";
import { TOOLS } from "@typescript-agent-harness/tools";
import { toolsFromMcp } from "./adapt.js";
import type { McpBackend } from "./types.js";

export type McpPluginOptions = {
  backend: McpBackend;
  /** Defaults to `"mcp"`. Pass a distinct name when mounting more than one server. */
  name?: string;
};

export function mcpPlugin(options: McpPluginOptions): Plugin {
  const { backend } = options;
  return {
    name: options.name ?? "mcp",
    async setup(ctx) {
      const tools = ctx.get(TOOLS);
      const infos = await backend.listTools();
      try {
        for (const tool of toolsFromMcp(backend, infos)) {
          tools.register(tool);
        }
      } catch (err) {
        await backend.close?.();
        throw err;
      }
    },
    async dispose() {
      await backend.close?.();
    },
  };
}
