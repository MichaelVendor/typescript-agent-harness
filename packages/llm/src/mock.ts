import type {
  ChatMessage,
  LLMRequest,
  LLMResponse,
  LLMService,
  LLMStreamPart,
  ToolCall,
} from "./types.js";
import { nextId } from "./ids.js";

type ListResult = {
  directory?: string;
  entries?: Array<{ name: string; type: string }>;
};

function toolNameByCallId(messages: ChatMessage[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls) {
      for (const c of m.toolCalls) map.set(c.id, c.name);
    }
  }
  return map;
}

function toolOutputs(messages: ChatMessage[]): Map<string, unknown> {
  const names = toolNameByCallId(messages);
  const out = new Map<string, unknown>();
  for (const m of messages) {
    if (m.role !== "tool") continue;
    const name = names.get(m.toolCallId);
    if (!name) continue;
    try {
      out.set(name, JSON.parse(m.content) as unknown);
    } catch {
      out.set(name, m.content);
    }
  }
  return out;
}

function call(name: string, args: unknown): { toolCalls: ToolCall[]; response: LLMResponse } {
  const toolCalls: ToolCall[] = [{ id: nextId("call"), name, arguments: args }];
  return {
    toolCalls,
    response: {
      id: nextId("llm"),
      model: "",
      message: { role: "assistant", toolCalls },
      toolCalls,
      finishReason: "tool_calls",
    },
  };
}

function summarize(outputs: Map<string, unknown>): string {
  const listing = outputs.get("list_files") as ListResult | undefined;
  const read = outputs.get("read_file") as
    | { path?: string; content?: string }
    | undefined;

  const entries = listing?.entries ?? [];
  const dirs = entries.filter((e) => e.type === "dir").map((e) => e.name);
  const files = entries.filter((e) => e.type === "file").map((e) => e.name);

  const lines = [
    "这是一个 TypeScript Agent Runtime 仓库（typescript-agent-harness）。",
    dirs.length
      ? `顶层目录：${dirs.join("、")}。`
      : "顶层没有子目录。",
    files.length
      ? `顶层文件：${files.join("、")}。`
      : "",
  ];

  if (read?.content) {
    const first = read.content
      .split("\n")
      .map((l) => l.trim())
      .find((l) => {
        if (!l) return false;
        if (l.startsWith("#") || l.startsWith("[") || l.startsWith("**")) return false;
        if (l.startsWith(">") || l.startsWith("```")) return false;
        return l.length > 20;
      });
    if (first) lines.push(`README 摘要：${first}`);
  }

  lines.push(
    "核心做法：用 Plugin 往 Runtime 上挂 LLM / Tools / Session，而不是把一切塞进一个 Agent 类。",
  );

  return lines.filter(Boolean).join("\n");
}

/**
 * Deterministic provider for demos and tests.
 * list_files → (optional) read README.md → short project summary.
 */
export function createMockLLM(defaultModel = "mock"): LLMService {
  async function generate(request: LLMRequest): Promise<LLMResponse> {
    const model = request.model ?? defaultModel;
    const has = (name: string) => request.tools?.some((t) => t.name === name);
    const outputs = toolOutputs(request.messages);
    const last = request.messages.at(-1);

    if (has("list_files") && !outputs.has("list_files")) {
      const { response } = call("list_files", { directory: "." });
      response.model = model;
      return response;
    }

    const listing = outputs.get("list_files") as ListResult | undefined;
    const hasReadme = listing?.entries?.some((e) => e.name.toLowerCase().startsWith("readme"));
    if (has("read_file") && hasReadme && !outputs.has("read_file")) {
      const name =
        listing?.entries?.find((e) => e.name === "README.zh-CN.md")?.name ??
        listing?.entries?.find((e) => e.name.toLowerCase().startsWith("readme"))?.name ??
        "README.md";
      const { response } = call("read_file", { path: name });
      response.model = model;
      return response;
    }

    if (outputs.size > 0) {
      return {
        id: nextId("llm"),
        model,
        message: { role: "assistant", content: summarize(outputs) },
        finishReason: "stop",
      };
    }

    return {
      id: nextId("llm"),
      model,
      message: {
        role: "assistant",
        content: last?.role === "user" ? `收到：${last.content}` : "OK",
      },
      finishReason: "stop",
    };
  }

  async function* stream(request: LLMRequest): AsyncIterable<LLMStreamPart> {
    const response = await generate(request);
    const text = response.message.content;
    if (text) {
      const size = 8;
      for (let i = 0; i < text.length; i += size) {
        yield { type: "text-delta", text: text.slice(i, i + size) };
      }
    }
    yield { type: "done", response };
  }

  return { generate, stream };
}
