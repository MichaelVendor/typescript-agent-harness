import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createOpenAICompatLLM, type LLMRetryInfo } from "@typescript-agent-harness/llm";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function sse(text: string): Response {
  const body =
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n` +
    "data: [DONE]\n\n";
  return new Response(body, { status: 200 });
}

function fakeFetch(responses: Array<Response | Error>): { calls: () => number } {
  let n = 0;
  globalThis.fetch = (async () => {
    const next = responses[n] ?? new Error("no more responses");
    n += 1;
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls: () => n };
}

async function collect(llm: ReturnType<typeof createOpenAICompatLLM>) {
  let text = "";
  for await (const part of llm.stream({ messages: [{ role: "user", content: "hi" }] })) {
    if (part.type === "text-delta") text += part.text;
  }
  return text;
}

test("retries 429/503 (honouring Retry-After) then streams once", async () => {
  const f = fakeFetch([
    new Response("busy", { status: 429, headers: { "retry-after": "0" } }),
    new Response("down", { status: 503, headers: { "retry-after": "0" } }),
    sse("hello"),
  ]);
  const retries: LLMRetryInfo[] = [];
  const llm = createOpenAICompatLLM({
    baseURL: "http://x",
    apiKey: "k",
    defaultModel: "m",
    onRetry: (info) => {
      retries.push(info);
    },
  });
  assert.equal(await collect(llm), "hello");
  assert.equal(f.calls(), 3);
  assert.deepEqual(
    retries.map((r) => [r.attempt, r.reason, r.delayMs]),
    [
      [1, "HTTP 429", 0],
      [2, "HTTP 503", 0],
    ],
  );
});

test("does not retry 400/401", async () => {
  const f = fakeFetch([new Response("bad key", { status: 401 })]);
  const llm = createOpenAICompatLLM({ baseURL: "http://x", apiKey: "k", defaultModel: "m" });
  await assert.rejects(collect(llm), /error 401: bad key/);
  assert.equal(f.calls(), 1);
});

test("gives up after maxRetries on network errors", async () => {
  const f = fakeFetch([new TypeError("fetch failed"), new TypeError("fetch failed")]);
  const llm = createOpenAICompatLLM({
    baseURL: "http://x",
    apiKey: "k",
    defaultModel: "m",
    maxRetries: 1,
  });
  await assert.rejects(collect(llm), /fetch failed/);
  assert.equal(f.calls(), 2);
});

test("abort during backoff stops retrying", async () => {
  const f = fakeFetch([new Response("down", { status: 503, headers: { "retry-after": "10" } })]);
  const controller = new AbortController();
  const llm = createOpenAICompatLLM({
    baseURL: "http://x",
    apiKey: "k",
    defaultModel: "m",
    onRetry: () => {
      setTimeout(() => controller.abort(), 10);
    },
  });
  const started = Date.now();
  await assert.rejects(async () => {
    for await (const _ of llm.stream({
      messages: [{ role: "user", content: "hi" }],
      signal: controller.signal,
    })) {
      // drain
    }
  });
  assert.ok(Date.now() - started < 2000);
  assert.equal(f.calls(), 1);
});
