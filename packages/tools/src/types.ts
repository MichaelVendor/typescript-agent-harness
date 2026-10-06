import type { Context } from "@typescript-agent-harness/core";
import type { JSONSchema, ToolCall } from "@typescript-agent-harness/llm";

export type ToolContext = {
  sessionId: string;
  callId: string;
  signal: AbortSignal;
  runtime: Pick<Context, "get" | "tryGet" | "emit">;
};

export type Tool<TInput = unknown, TOutput = unknown> = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(input: TInput, ctx: ToolContext): Promise<TOutput>;
};

export type ToolResult = {
  callId: string;
  name: string;
  ok: boolean;
  output: unknown;
};

export type ToolService = {
  register(tool: Tool): void;
  list(): Tool[];
  listSchemas(): Array<{ name: string; description: string; inputSchema: JSONSchema }>;
  execute(call: ToolCall, ctx: ToolContext): Promise<ToolResult>;
};
