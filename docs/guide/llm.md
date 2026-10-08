# LLM

状态：✅ `packages/llm` · Loop 走 `stream()`；OpenAI 兼容走 SSE

## 角色

LLM 是 Runtime 上的一个 capability：提供统一的生成 / 流式接口，屏蔽具体厂商。

```ts
const LLM = createServiceKey<LLMService>("llm");

interface LLMService {
  generate(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMStreamPart>;
}
```

## 请求 / 响应

与 `packages/llm` 类型一致。`model` 可省略，由插件 `defaultModel` 填入。

```ts
interface LLMRequest {
  messages: ChatMessage[];
  model?: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

interface LLMResponse {
  id: string;
  model: string;
  message: AssistantMessage;
  toolCalls?: ToolCall[];
  usage?: TokenUsage;
  finishReason: "stop" | "tool_calls" | "length" | "cancelled" | "error";
}

type LLMStreamPart =
  | { type: "text-delta"; text: string }
  | { type: "done"; response: LLMResponse };
```

消息类型贴近 OpenAI 兼容协议（当前 `user` / `system` 内容为 string，无多模态 part）：

```ts
type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; content: string };
```

## Provider 插件

```ts
runtime.use(
  llmPlugin({
    provider: "openai-compatible", // 或 "mock"
    baseURL: process.env.DEEPSEEK_BASE_URL, // 默认 https://api.deepseek.com/v1
    apiKey: process.env.DEEPSEEK_API_KEY,
    defaultModel: "deepseek-chat",
  }),
);
```

也识别 `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL`。

| Provider | 说明 |
| --- | --- |
| `mock` | 插件默认；示例与 CLI `--mock` |
| `openai-compatible` | DeepSeek / 网关 / 本地代理 |

一次 Runtime 挂一个 provider。默认模型写进 `llm.request` 事件。

### 重试（v0.22，openai-compatible）

`maxRetries`（默认 3）：网络错误、408 / 429 / 5xx 时指数退避重试（1s、2s、4s…，单次最多 20s；有 `Retry-After` 就按它）。400 / 401 等不重试。

只在**响应开始之前**重试：一旦开始流式输出，中途断了就直接报错，避免同一段文字被打印两次。退避期间 `signal` 取消立即生效。每次重试发 `llm.retry`。

## 事件

LLM 插件在调用前后发事件，供 Trace / Billing 使用，**不**要求 Agent 感知：

| 事件 | Payload（概念） |
| --- | --- |
| `llm.request` | `{ requestId, model, messageCount }` |
| `llm.response` | `{ requestId, usage, finishReason }` |
| `llm.error` | `{ requestId, error }` |
| `llm.stream` | `{ requestId, text }` |
| `llm.retry` | `{ attempt, delayMs, reason }`（v0.22） |

## 设计约束

1. Agent Loop 只依赖 `LLMService`，不依赖某个 SDK  
2. Token usage 必须出现在事件或 response 上，便于计费插件  
3. `signal` 用于取消；取消不得污染已提交的 Session 事件  
4. 系统提示词组装（system prompt sections）属于 Agent / Prompt 插件，不属于某个具体 Provider  
