import type { JSONSchema } from "@typescript-agent-harness/llm";

export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
};

export type McpBackend = {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  close?(): Promise<void>;
};
