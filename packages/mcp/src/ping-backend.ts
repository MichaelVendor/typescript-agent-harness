import type { McpBackend, McpToolInfo } from "./types.js";

export function inProcessPingBackend(): McpBackend {
  const tools: McpToolInfo[] = [
    {
      name: "ping",
      description: "MCP ping. Returns { pong: text }.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Optional payload" },
        },
        additionalProperties: false,
      },
    },
  ];

  return {
    async listTools() {
      return tools;
    },
    async callTool(name, args) {
      if (name !== "ping") throw new Error(`unknown MCP tool: ${name}`);
      const text =
        args && typeof args === "object" && "text" in args
          ? String((args as { text: unknown }).text ?? "")
          : "";
      return { pong: text || "ok" };
    },
  };
}
