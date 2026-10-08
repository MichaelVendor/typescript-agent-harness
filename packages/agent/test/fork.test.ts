import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type LLMService } from "@typescript-agent-harness/llm";
import { toolsPlugin } from "@typescript-agent-harness/tools";

function echoLLM(): LLMService {
  return {
    async generate() {
      throw new Error("use stream");
    },
    async *stream(req) {
      const last = req.messages[req.messages.length - 1];
      yield {
        type: "done" as const,
        response: {
          id: "r",
          model: "stub",
          message: { role: "assistant" as const, content: `echo:${last?.content ?? ""}` },
          finishReason: "stop" as const,
        },
      };
    },
  };
}

async function boot() {
  const runtime = new Runtime({ id: "fork" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, echoLLM()) })
    .use(toolsPlugin())
    .use(agentPlugin({ systemPrompt: "sys" }));
  await runtime.start();
  return runtime;
}

const users = (messages: { role: string; content?: string }[]) =>
  messages.filter((m) => m.role === "user").map((m) => m.content);

test("fork copies history; the two sessions then diverge", async () => {
  const runtime = await boot();
  const sessions = runtime.get(SESSION);
  const source = await sessions.create();
  await source.run("a");
  await source.run("b");

  const forked = await sessions.fork(source.id);
  assert.notEqual(forked.id, source.id);
  assert.deepEqual(users(forked.messages), ["a", "b"]);

  await forked.run("c");
  assert.deepEqual(users(forked.messages), ["a", "b", "c"]);
  assert.deepEqual(users(source.messages), ["a", "b"]);
  await runtime.stop();
});

test("fork with turns keeps only the first N turns", async () => {
  const runtime = await boot();
  const sessions = runtime.get(SESSION);
  const source = await sessions.create();
  await source.run("a");
  await source.run("b");
  await source.run("c");

  const forked = await sessions.fork(source.id, { turns: 1 });
  assert.deepEqual(users(forked.messages), ["a"]);
  assert.equal(forked.messages[0]?.role, "system");
  assert.equal(forked.messages[forked.messages.length - 1]?.content, "echo:a");

  const empty = await sessions.fork(source.id, { turns: 0 });
  assert.deepEqual(empty.messages.map((m) => m.role), ["system"]);

  await assert.rejects(sessions.fork(source.id, { turns: -1 }), /non-negative/);
  await assert.rejects(sessions.fork("nope"), /not found/);
  await runtime.stop();
});
