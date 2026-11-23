import type { Plugin } from "@typescript-agent-harness/core";
import { TOOLS } from "@typescript-agent-harness/tools";
import { toolsFromMcp } from "./adapt.js";
import type { McpBackend } from "./types.js";

export type McpToolExposure = "eager" | "lazy";

export type McpPluginOptions = {
  backend: McpBackend;
  /** Defaults to `"mcp"`. Pass a distinct name when mounting more than one server. */
  name?: string;
  /** Defaults to `"eager"`. */
  toolExposure?: McpToolExposure;
};

function discoveryToolNames(pluginName: string): { list: string; enable: string } {
  if (pluginName === "mcp") {
    return { list: "mcp_list_tools", enable: "mcp_enable_tools" };
  }
  const base = pluginName.replace(/:/g, "_");
  return { list: `${base}_list_tools`, enable: `${base}_enable_tools` };
}

export function mcpPlugin(options: McpPluginOptions): Plugin {
  const { backend } = options;
  const toolExposure = options.toolExposure ?? "eager";
  const pluginName = options.name ?? "mcp";
  return {
    name: pluginName,
    async setup(ctx) {
      const tools = ctx.get(TOOLS);
      const infos = await backend.listTools();
      try {
        if (toolExposure === "eager") {
          for (const tool of toolsFromMcp(backend, infos)) {
            tools.register(tool);
          }
          return;
        }

        const { list: listName, enable: enableName } = discoveryToolNames(pluginName);
        const enabled = new Set<string>();

        tools.register({
          name: listName,
          description: `List MCP tools available from server "${pluginName}" (not yet enabled for the model).`,
          inputSchema: { type: "object", properties: {} },
          async execute() {
            return infos.map((info) => ({ name: info.name, description: info.description }));
          },
        });

        tools.register({
          name: enableName,
          description: `Enable MCP tools by name for server "${pluginName}" so they appear in the session tool set.`,
          inputSchema: {
            type: "object",
            properties: {
              names: { type: "array", items: { type: "string" }, description: "Remote tool names to enable" },
            },
            required: ["names"],
          },
          async execute(input) {
            const names = Array.isArray((input as { names?: unknown }).names)
              ? ((input as { names: string[] }).names ?? [])
              : [];
            const byName = new Map(infos.map((info) => [info.name, info]));
            const enabledNow: string[] = [];
            const unknown: string[] = [];
            for (const name of names) {
              if (typeof name !== "string" || name.length === 0) continue;
              const info = byName.get(name);
              if (!info) {
                unknown.push(name);
                continue;
              }
              if (enabled.has(name)) continue;
              const tool = toolsFromMcp(backend, [info])[0];
              if (!tool) continue;
              tools.register(tool);
              enabled.add(name);
              enabledNow.push(name);
            }
            return { enabled: enabledNow, skipped: names.filter((n) => enabled.has(n) && !enabledNow.includes(n)), unknown };
          },
        });
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