import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPlugin, applySummary, SESSION, SUMMARY_PREFIX } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type ChatMessage, type LLMRequest, type LLMService } from "@typescript-agent-harness/llm";
import { toolsPlugin } from "@typescript-agent-harness/tools";

test("applySummary: the latest summary joins the system prompt and hides what it covers", () => {
  const messages: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "one" },
    { role: "system", content: `${SUMMARY_PREFIX}\nold` },
    { role: "user", content: "two" },
    { role: "system", content: `${SUMMARY_PREFIX}\nnew` },
    { role: "user", content: "three" },
  ];
  assert.deepEqual(applySummary(messages), [
    { role: "system", content: `sys\n\n${SUMMARY_PREFIX}\nnew` },
    { role: "user", content: "three" },
  ]);
  assert.equal(applySummary(messages.slice(0, 2)).length, 2);
});

function stub(reply: string) {
  const sent: LLMRequest[] = [];
  const summarized: LLMRequest[] = [];
  const llm: LLMService = {
    async generate(req) {
      summarized.push(req);
      return {
        id: "s",
        model: "stub",
        message: { role: "assistant", content: `summary ${summarized.length}` },
        finishReason: "stop",
      };
    },
    async *stream(req) {
      sent.push(req);
      yield {
        type: "done" as const,
        response: { id: "r", model: "stub", message: { role: "assistant" as const, content: reply }, finishReason: "stop" as const },
      };
    },
  };
  return { llm, sent, summarized };
}

async function boot(llm: LLMService, contextChars?: number) {
  const runtime = new Runtime({ id: "compact" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, llm) })
    .use(toolsPlugin())
    .use(agentPlugin({ systemPrompt: "sys", ...(contextChars ? { contextChars } : {}) }));
  const compacted: unknown[] = [];
  runtime.on("agent.context.compacted", (e) => {
    compacted.push(e);
  });
  await runtime.start();
  return { runtime, compacted, session: await runtime.get(SESSION).create() };
}

test("over budget, earlier turns are summarized before the request; history is kept", async () => {
  const { llm, sent, summarized } = stub("x".repeat(3000));
  const { runtime, compacted, session } = await boot(llm, 2000);
  await session.run("one");
  await session.run("two");
  await session.run("three");

  assert.equal(compacted.length, 2);
  assert.match(JSON.stringify(compacted[0]), /"turns":1,.*"auto":true/);
  assert.match(String(summarized[1]!.messages[1]!.content), /^Summary so far:\nsummary 1\n\nLater conversation:\nUSER: two/);
  const last = sent.at(-1)!;
  assert.equal(last.messages[0]!.content, `sys\n\n${SUMMARY_PREFIX}\nsummary 2`);
  assert.deepEqual(last.messages.slice(1).map((m) => m.content), ["three"]);
  assert.deepEqual(
    session.messages.filter((m) => m.role === "user").map((m) => m.content),
    ["one", "two", "three"],
  );
  await runtime.stop();
});

test("compact() summarizes every turn so far; nothing to compact returns undefined", async () => {
  const { llm, sent, summarized } = stub("ok");
  const { runtime, compacted, session } = await boot(llm);
  assert.equal(await session.compact(), undefined);
  assert.equal(summarized.length, 0);

  await session.run("one");
  const done = await session.compact();
  assert.equal(done?.turns, 1);
  assert.match(JSON.stringify(compacted), /"auto":false/);
  assert.equal(await session.compact(), undefined);

  await session.run("two");
  assert.deepEqual(sent.at(-1)!.messages.map((m) => m.content), [`sys\n\n${SUMMARY_PREFIX}\nsummary 1`, "two"]);
  await runtime.stop();
});
