import type {
  ChatMessage,
  FinishReason,
  LLMRequest,
  LLMResponse,
  LLMService,
  LLMStreamPart,
  ToolCall,
  TokenUsage,
} from "./types.js";
import { nextId } from "./ids.js";

export type OpenAICompatConfig = {
  baseURL: string;
  apiKey: string;
  defaultModel: string;
};

type OpenAIMessage = {
  role: string;
  content?: string | null;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

function toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === "assistant") {
      const out: OpenAIMessage = { role: "assistant", content: m.content ?? null };
      if (m.toolCalls?.length) {
        out.tool_calls = m.toolCalls.map((c) => ({
          id: c.id,
          type: "function",
          function: {
            name: c.name,
            arguments:
              typeof c.arguments === "string"
                ? c.arguments
                : JSON.stringify(c.arguments ?? {}),
          },
        }));
      }
      return out;
    }
    return { role: m.role, content: m.content };
  });
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function mapFinish(reason: string | null | undefined): FinishReason {
  if (reason === "tool_calls") return "tool_calls";
  if (reason === "length") return "length";
  return "stop";
}

function requestBody(
  request: LLMRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(request.messages),
    stream,
  };
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.tools?.length) {
    body.tools = request.tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.inputSchema,
      },
    }));
  }
  return body;
}

export function createOpenAICompatLLM(config: OpenAICompatConfig): LLMService {
  const base = config.baseURL.replace(/\/$/, "");

  async function chatCompletions(request: LLMRequest, stream: boolean): Promise<Response> {
    const model = request.model ?? config.defaultModel;
    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody(request, model, stream)),
    };
    if (request.signal) init.signal = request.signal;
    const res = await fetch(`${base}/chat/completions`, init);
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI-compatible error ${res.status}: ${text}`);
    }
    return res;
  }

  async function generate(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? config.defaultModel;
    const res = await chatCompletions(request, false);
    const json = (await res.json()) as {
      id?: string;
      model?: string;
      choices?: Array<{
        finish_reason?: string;
        message?: OpenAIMessage;
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const choice = json.choices?.[0];
    const msg = choice?.message;
    const toolCalls: ToolCall[] | undefined = msg?.tool_calls?.map((c) => ({
      id: c.id,
      name: c.function.name,
      arguments: parseArgs(c.function.arguments),
    }));

    const usage: TokenUsage | undefined = json.usage
      ? {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        }
      : undefined;

    const assistant: Extract<ChatMessage, { role: "assistant" }> = {
      role: "assistant",
    };
    if (msg?.content) assistant.content = msg.content;
    if (toolCalls?.length) assistant.toolCalls = toolCalls;

    const response: LLMResponse = {
      id: json.id ?? nextId("llm"),
      model: json.model ?? model,
      message: assistant,
      finishReason: mapFinish(choice?.finish_reason),
    };
    if (toolCalls?.length) response.toolCalls = toolCalls;
    if (usage) response.usage = usage;
    return response;
  }

  async function* stream(request: LLMRequest): AsyncIterable<LLMStreamPart> {
    const model = request.model ?? config.defaultModel;
    const res = await chatCompletions(request, true);
    if (!res.body) throw new Error("OpenAI-compatible stream: empty body");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let content = "";
    let id = nextId("llm");
    let outModel = model;
    let finish: FinishReason = "stop";
    const toolParts = new Map<
      number,
      { id: string; name: string; args: string }
    >();
    let usage: TokenUsage | undefined;

    const flushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") return;
      const json = JSON.parse(data) as {
        id?: string;
        model?: string;
        choices?: Array<{
          finish_reason?: string | null;
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
      if (json.id) id = json.id;
      if (json.model) outModel = json.model;
      if (json.usage) {
        usage = {
          promptTokens: json.usage.prompt_tokens ?? 0,
          completionTokens: json.usage.completion_tokens ?? 0,
          totalTokens: json.usage.total_tokens ?? 0,
        };
      }
      const choice = json.choices?.[0];
      if (choice?.finish_reason) finish = mapFinish(choice.finish_reason);
      const delta = choice?.delta;
      if (delta?.content) content += delta.content;
      for (const tc of delta?.tool_calls ?? []) {
        const index = tc.index ?? 0;
        const prev = toolParts.get(index) ?? { id: "", name: "", args: "" };
        if (tc.id) prev.id = tc.id;
        if (tc.function?.name) prev.name += tc.function.name;
        if (tc.function?.arguments) prev.args += tc.function.arguments;
        toolParts.set(index, prev);
      }
      return delta?.content ?? "";
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const piece = flushLine(line);
        if (piece) yield { type: "text-delta", text: piece };
      }
    }
    if (buf.trim()) {
      const piece = flushLine(buf);
      if (piece) yield { type: "text-delta", text: piece };
    }

    const toolCalls: ToolCall[] = [...toolParts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, t]) => ({
        id: t.id || nextId("call"),
        name: t.name,
        arguments: parseArgs(t.args),
      }));

    const assistant: Extract<ChatMessage, { role: "assistant" }> = {
      role: "assistant",
    };
    if (content) assistant.content = content;
    if (toolCalls.length) assistant.toolCalls = toolCalls;

    const response: LLMResponse = {
      id,
      model: outModel,
      message: assistant,
      finishReason: toolCalls.length ? "tool_calls" : finish,
    };
    if (toolCalls.length) response.toolCalls = toolCalls;
    if (usage) response.usage = usage;
    yield { type: "done", response };
  }

  return { generate, stream };
}
