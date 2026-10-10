import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, llmPlugin } from "@typescript-agent-harness/llm";

const realFetch = globalThis.fetch;
const KEYS = ["DEEPSEEK_API_KEY", "DEEPSEEK_BASE_URL", "DEEPSEEK_MODEL", "OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_MODEL"];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function requestedUrl(env: Record<string, string>): Promise<{ url: string; model: unknown }> {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, env);
  let seen: { url: string; model: unknown } | undefined;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    seen = { url: String(url), model: (JSON.parse(String(init?.body)) as { model: unknown }).model };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`);
  }) as typeof fetch;
  const runtime = new Runtime();
  runtime.use(llmPlugin({ provider: "openai-compatible" }));
  await runtime.start();
  for await (const _ of runtime.context().get(LLM).stream({ messages: [{ role: "user", content: "hi" }] })) {
    // drain
  }
  await runtime.stop();
  assert.ok(seen);
  return seen;
}

test("OPENAI_API_KEY alone goes to api.openai.com", async () => {
  assert.deepEqual(await requestedUrl({ OPENAI_API_KEY: "sk-test" }), {
    url: "https://api.openai.com/v1/chat/completions",
    model: "gpt-4o-mini",
  });
});

test("DEEPSEEK_API_KEY alone goes to api.deepseek.com", async () => {
  assert.deepEqual(await requestedUrl({ DEEPSEEK_API_KEY: "sk-test" }), {
    url: "https://api.deepseek.com/v1/chat/completions",
    model: "deepseek-chat",
  });
});
