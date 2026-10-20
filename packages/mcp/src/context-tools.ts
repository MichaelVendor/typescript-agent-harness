import type { Tool } from "@typescript-agent-harness/tools";
import type { McpBackend, McpPromptInfo, McpResourceInfo } from "./types.js";

type ServerSnapshot = {
  label: string;
  backend: McpBackend;
  resources: McpResourceInfo[];
  prompts: McpPromptInfo[];
};

type ReadResourceInput = { uri: string };
type GetPromptInput = {
  name: string;
  arguments?: Record<string, string>;
  server?: string;
};

export async function contextToolsFromMcp(
  servers: { label: string; backend: McpBackend }[],
): Promise<Tool[]> {
  const snapshots: ServerSnapshot[] = await Promise.all(
    servers.map(async ({ label, backend }) => {
      const [resources, prompts] = await Promise.all([
        backend.listResources(),
        backend.listPrompts(),
      ]);
      return { label, backend, resources, prompts };
    }),
  );
  const tools: Tool[] = [];

  if (snapshots.some(({ resources }) => resources.length > 0)) {
    tools.push({
      name: "list_resources",
      description: "List available MCP resources.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute() {
        return snapshots.flatMap(({ label, resources }) =>
          resources.map(({ uri, name, mimeType }) => ({
            server: label,
            uri,
            name,
            mimeType: mimeType ?? "",
          })),
        );
      },
    });

    tools.push({
      name: "read_resource",
      description: "Read an MCP resource by URI.",
      inputSchema: {
        type: "object",
        properties: { uri: { type: "string" } },
        required: ["uri"],
        additionalProperties: false,
      },
      async execute(input: ReadResourceInput) {
        const snapshot = snapshots.find(({ resources }) =>
          resources.some(({ uri }) => uri === input.uri),
        );
        if (!snapshot) throw new Error(`unknown resource: ${input.uri}`);
        const content = await snapshot.backend.readResource(input.uri);
        return content
          .map((part) =>
            "text" in part
              ? part.text
              : `已省略（${part.mimeType ?? "application/octet-stream"}）`,
          )
          .join("\n");
      },
    });
  }

  const promptEntries = snapshots.flatMap((snapshot) =>
    snapshot.prompts.map((prompt) => ({ snapshot, prompt })),
  );
  if (promptEntries.length > 0) {
    const promptList = promptEntries
      .map(({ snapshot, prompt }) => {
        const args = prompt.arguments?.map(({ name }) => name).join(", ") ?? "";
        return `${prompt.name} (${snapshot.label})${args ? `: ${args}` : ""}`;
      })
      .join("; ");
    tools.push({
      name: "get_prompt",
      description: `Get an MCP prompt. Available prompts: ${promptList}`,
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          arguments: { type: "object" },
          server: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
      async execute(input: GetPromptInput) {
        const matches = promptEntries.filter(
          ({ snapshot, prompt }) =>
            prompt.name === input.name &&
            (input.server === undefined || snapshot.label === input.server),
        );
        if (matches.length === 0) throw new Error(`unknown prompt: ${input.name}`);
        if (matches.length > 1 && input.server === undefined) {
          throw new Error(`prompt ${input.name} requires server`);
        }
        const match = matches[0]!;
        const messages = await match.snapshot.backend.getPrompt(input.name, input.arguments);
        return messages.map(({ text }) => text).join("\n\n");
      },
    });
  }

  return tools;
}
