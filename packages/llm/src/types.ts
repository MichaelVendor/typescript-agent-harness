export type JSONSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JSONSchema;
};

export type ToolSchema = {
  name: string;
  description: string;
  inputSchema: JSONSchema;
};

export type ToolCall = {
  id: string;
  name: string;
  arguments: unknown;
};

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/** OpenAI-compatible multimodal parts on a user message. */
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | ContentPart[] }
  | { role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };

export type FinishReason =
  | "stop"
  | "tool_calls"
  | "length"
  | "cancelled"
  | "error";

export type LLMRequest = {
  messages: ChatMessage[];
  model?: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
};

export type LLMResponse = {
  id: string;
  model: string;
  message: Extract<ChatMessage, { role: "assistant" }>;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason: FinishReason;
};

export type LLMStreamPart =
  | { type: "text-delta"; text: string }
  | { type: "done"; response: LLMResponse };

export type LLMService = {
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamPart>;
};
