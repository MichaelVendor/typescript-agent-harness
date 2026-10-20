import type { JSONSchema } from "@typescript-agent-harness/llm";

export type McpToolInfo = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
};

export type McpResourceInfo = { uri: string; name: string; mimeType?: string };
export type McpPromptArg = { name: string; required?: boolean };
export type McpPromptInfo = { name: string; arguments?: McpPromptArg[] };
export type McpResourceContent =
  | { mimeType?: string; text: string }
  | { mimeType?: string; blob: string };
export type McpPromptMessage = { text: string };

export type McpBackend = {
  listTools(): Promise<McpToolInfo[]>;
  callTool(name: string, args: unknown): Promise<unknown>;
  listResources(): Promise<McpResourceInfo[]>;
  readResource(uri: string): Promise<McpResourceContent[]>;
  listPrompts(): Promise<McpPromptInfo[]>;
  getPrompt(name: string, args?: Record<string, string>): Promise<McpPromptMessage[]>;
  close?(): Promise<void>;
};
