import type { Tool } from "@typescript-agent-harness/tools";
import type { McpBackend } from "./types.js";

/** MCP `tools/call` result → text for the model: text parts joined, other parts noted, `isError` thrown. */
export function mcpResultText(result: unknown): unknown {
  const content = (result as { content?: unknown } | null | undefined)?.content;
  if (!Array.isArray(content)) return result;
  const text = (content as Array<{ type?: string; text?: string }>)
    .map((p) => (p.type === "text" ? (p.text ?? "") : `[${p.type ?? "unknown"} omitted]`))
    .join("\n");
  if ((result as { isError?: boolean }).isError) throw new Error(text || "MCP tool failed");
  return text;
}

export function toolsFromMcp(backend: McpBackend, infos: Awaited<ReturnType<McpBackend["listTools"]>>): Tool[] {
  return infos.map((info) => ({
    name: info.name,
    description: info.description,
    inputSchema: info.inputSchema,
    async execute(input) {
      return mcpResultText(await backend.callTool(info.name, input));
    },
  }));
}
