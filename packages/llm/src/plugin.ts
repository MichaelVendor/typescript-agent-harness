import type { Context, Plugin } from "@typescript-agent-harness/core";
import { LLM } from "./contract.js";
import { createMockLLM } from "./mock.js";
import { createOpenAICompatLLM } from "./openai.js";
import type { LLMRequest, LLMResponse, LLMService } from "./types.js";

export type LLMPluginOptions = {
  /** mock (default) | openai-compatible */
  provider?: "mock" | "openai-compatible";
  defaultModel?: string;
  baseURL?: string;
  apiKey?: string;
  /** openai-compatible only: retries before the response starts (emits `llm.retry`). Default 3. */
  maxRetries?: number;
};

function wrapWithEvents(
  inner: LLMService,
  ctx: Context,
  defaultModel: string,
): LLMService {
  return {
    async generate(request: LLMRequest) {
      const requestId = `${Date.now().toString(36)}`;
      const model = request.model ?? defaultModel;
      await ctx.emit("llm.request", {
        requestId,
        model,
        messageCount: request.messages.length,
      });
      try {
        const response = await inner.generate({ ...request, model });
        await ctx.emit("llm.response", {
          requestId,
          model: response.model,
          finishReason: response.finishReason,
          usage: response.usage,
        });
        return response;
      } catch (error) {
        await ctx.emit("llm.error", { requestId, error });
        throw error;
      }
    },
    async *stream(request: LLMRequest) {
      const requestId = `${Date.now().toString(36)}`;
      const model = request.model ?? defaultModel;
      await ctx.emit("llm.request", {
        requestId,
        model,
        messageCount: request.messages.length,
      });
      try {
        let doneResponse: LLMResponse | undefined;
        for await (const part of inner.stream({ ...request, model })) {
          if (part.type === "text-delta") {
            await ctx.emit("llm.stream", { requestId, text: part.text });
          } else if (part.type === "done") {
            doneResponse = part.response;
          }
          yield part;
        }
        if (doneResponse) {
          await ctx.emit("llm.response", {
            requestId,
            model: doneResponse.model,
            finishReason: doneResponse.finishReason,
            usage: doneResponse.usage,
          });
        }
      } catch (error) {
        await ctx.emit("llm.error", { requestId, error });
        throw error;
      }
    },
  };
}

export function llmPlugin(options: LLMPluginOptions = {}): Plugin {
  const provider = options.provider ?? "mock";

  return {
    name: "llm",
    setup(ctx) {
      let service: LLMService;
      if (provider === "openai-compatible") {
        const apiKey =
          options.apiKey ??
          process.env.DEEPSEEK_API_KEY ??
          process.env.OPENAI_API_KEY;
        const baseURL =
          options.baseURL ??
          process.env.DEEPSEEK_BASE_URL ??
          process.env.OPENAI_BASE_URL ??
          (process.env.DEEPSEEK_API_KEY
            ? "https://api.deepseek.com/v1"
            : undefined);
        const defaultModel =
          options.defaultModel ??
          process.env.DEEPSEEK_MODEL ??
          process.env.OPENAI_MODEL ??
          (process.env.DEEPSEEK_API_KEY ? "deepseek-chat" : "gpt-4o-mini");
        if (!baseURL || !apiKey) {
          throw new Error(
            "openai-compatible provider requires apiKey + baseURL (DEEPSEEK_API_KEY or OPENAI_API_KEY / OPENAI_BASE_URL)",
          );
        }
        service = createOpenAICompatLLM({
          baseURL,
          apiKey,
          defaultModel,
          ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
          onRetry: (info) => ctx.emit("llm.retry", info),
        });
        ctx.provide(LLM, wrapWithEvents(service, ctx, defaultModel));
      } else {
        const mockModel = options.defaultModel ?? "mock";
        service = createMockLLM(mockModel);
        ctx.provide(LLM, wrapWithEvents(service, ctx, mockModel));
      }
    },
  };
}
