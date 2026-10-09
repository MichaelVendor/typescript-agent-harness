import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type LLMService } from "@typescript-agent-harness/llm";
import { listFilesTool, toolsPlugin } from "@typescript-agent-harness/tools";

function alwaysToolLLM(): LLMService {
  let n = 0;
  return {
    async generate() {
      throw new Error("use stream");
    },
    async *stream() {
      n += 1;
      const id = `call_${n}`;
      const toolCalls = [{ id, name: "list_files", arguments: { directory: "." } }];
      yield {
        type: "done" as const,
        response: {
          id: `llm_${n}`,
          model: "stub",
          message: { role: "assistant" as const, toolCalls },
          toolCalls,
          finishReason: "tool_calls" as const,
        },
      };
    },
  };
}

test("hitting maxSteps returns readable text and failed state", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tah-max-"));
  const runtime = new Runtime({ id: "max-steps" });
  runtime
    .use({
      name: "stub-llm",
      setup(ctx) {
        ctx.provide(LLM, alwaysToolLLM());
      },
    })
    .use(toolsPlugin({ tools: [listFilesTool(root)] }))
    .use(agentPlugin({ maxSteps: 2 }));
  await runtime.start();
  const session = await runtime.get(SESSION).create();
  const result = await session.run("explore forever");
  assert.equal(result.finishReason, "max_steps");
  assert.equal(session.state, "failed");
  assert.match(result.text, /maxSteps=2/);
  assert.match(result.text, /step limit|LLM/i);
  await runtime.stop();
});

test("maxSteps defaults to 20", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tah-max-"));
  const runtime = new Runtime({ id: "max-steps-default" });
  runtime
    .use({
      name: "stub-llm",
      setup(ctx) {
        ctx.provide(LLM, alwaysToolLLM());
      },
    })
    .use(toolsPlugin({ tools: [listFilesTool(root)] }))
    .use(agentPlugin());
  await runtime.start();
  const session = await runtime.get(SESSION).create();
  const result = await session.run("explore forever");
  assert.equal(result.finishReason, "max_steps");
  assert.equal(session.steps.filter((s) => s.type === "llm").length, 20);
  await runtime.stop();
});

test("resume after maxSteps continues the turn with a fresh step budget", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tah-max-"));
  const runtime = new Runtime({ id: "max-steps-resume" });
  runtime
    .use({
      name: "stub-llm",
      setup(ctx) {
        ctx.provide(LLM, alwaysToolLLM());
      },
    })
    .use(toolsPlugin({ tools: [listFilesTool(root)] }))
    .use(agentPlugin({ maxSteps: 2 }));
  await runtime.start();
  const session = await runtime.get(SESSION).create();
  await session.run("explore forever");
  const result = await session.resume();
  assert.equal(result.finishReason, "max_steps");
  assert.equal(session.steps.filter((s) => s.type === "llm").length, 4);
  assert.equal(session.messages.filter((m) => m.role === "user").length, 1);
  await runtime.stop();
});
