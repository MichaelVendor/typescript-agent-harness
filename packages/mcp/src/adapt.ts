import type { Tool } from "@typescript-agent-harness/tools";
import type { McpBackend } from "./types.js";

export function toolsFromMcp(backend: McpBackend, infos: Awaited<ReturnType<McpBackend["listTools"]>>): Tool[] {
  return infos.map((info) => ({
    name: info.name,
    description: info.description,
    inputSchema: info.inputSchema,
    async execute(input) {
      return backend.callTool(info.name, input);
    },
  }));
}
