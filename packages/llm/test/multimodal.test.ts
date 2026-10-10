import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createOpenAICompatLLM } from "@typescript-agent-harness/llm";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("user ContentPart[] maps to OpenAI multimodal content", async () => {
  let body: { messages: Array<{ content: unknown }> } | undefined;
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as typeof body;
    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
    }));
  }) as typeof fetch;

  const llm = createOpenAICompatLLM({
    baseURL: "http://example.test/v1",
    apiKey: "sk",
    defaultModel: "vision",
  });
  await llm.generate({
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "what is this?" },
          { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
        ],
      },
    ],
  });
  assert.deepEqual(body?.messages[0]?.content, [
    { type: "text", text: "what is this?" },
    { type: "image_url", image_url: { url: "data:image/png;base64,aa" } },
  ]);
});
