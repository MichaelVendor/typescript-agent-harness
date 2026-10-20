import type {
  McpBackend,
  McpPromptArg,
  McpResourceContent,
  McpToolInfo,
} from "./types.js";

type McpClientContent = { mimeType?: string | undefined } & ({ text: string } | { blob: string });
type McpClientPromptArg = { name: string; required?: boolean | undefined };

export type McpClientLike = {
  listTools(): Promise<{
    tools: { name: string; description?: string | undefined; inputSchema: { type: "object"; [key: string]: unknown } }[];
  }>;
  callTool(args: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  listResources(): Promise<{
    resources: { uri: string; name: string; mimeType?: string | undefined }[];
  }>;
  readResource(args: { uri: string }): Promise<{ contents: McpClientContent[] }>;
  listPrompts(): Promise<{
    prompts: { name: string; arguments?: McpClientPromptArg[] | undefined }[];
  }>;
  getPrompt(args: { name: string; arguments?: Record<string, string> }): Promise<{
    messages: { content: { type?: string | undefined; text?: string | undefined } }[];
  }>;
  close(): Promise<void>;
};

/** Adapt an official MCP client onto McpBackend. */
export function backendFromClient(client: McpClientLike): McpBackend {
  return {
    async listTools() {
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema as McpToolInfo["inputSchema"],
      }));
    },
    callTool(name, args) {
      return client.callTool({
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      });
    },
    async listResources() {
      const { resources } = await client.listResources();
      return resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        ...(r.mimeType !== undefined ? { mimeType: r.mimeType } : {}),
      }));
    },
    async readResource(uri) {
      const { contents } = await client.readResource({ uri });
      return contents.map((c): McpResourceContent => {
        const mimeType = c.mimeType !== undefined ? { mimeType: c.mimeType } : {};
        return "text" in c ? { ...mimeType, text: c.text } : { ...mimeType, blob: c.blob };
      });
    },
    async listPrompts() {
      const { prompts } = await client.listPrompts();
      return prompts.map((p) => ({
        name: p.name,
        ...(p.arguments !== undefined
          ? {
              arguments: p.arguments.map((a): McpPromptArg => ({
                name: a.name,
                ...(a.required !== undefined ? { required: a.required } : {}),
              })),
            }
          : {}),
      }));
    },
    async getPrompt(name, args) {
      const { messages } = await client.getPrompt({
        name,
        ...(args !== undefined ? { arguments: args } : {}),
      });
      const out: { text: string }[] = [];
      for (const m of messages) {
        if (m.content.type === "text" || typeof m.content.text === "string") {
          out.push({ text: m.content.text ?? "" });
        }
      }
      return out;
    },
    close: () => client.close(),
  };
}
