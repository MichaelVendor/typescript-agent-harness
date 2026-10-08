import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type LLMRequest, type LLMService } from "@typescript-agent-harness/llm";
import { toolsPlugin, type Tool } from "@typescript-agent-harness/tools";

test("cancel mid-tool, then the next turn sends a result for every tool call", async () => {
  const requests: LLMRequest[] = [];
  const llm: LLMService = {
    async generate() {
      throw new Error("use stream");
    },
    async *stream(req) {
      requests.push(req);
      const toolCalls =
        requests.length === 1
          ? [
              { id: "call_1", name: "slow", arguments: {} },
              { id: "call_2", name: "slow", arguments: {} },
            ]
          : undefined;
      yield {
        type: "done" as const,
        response: {
          id: `r${requests.length}`,
          model: "stub",
          message: toolCalls
            ? { role: "assistant" as const, toolCalls }
            : { role: "assistant" as const, content: "ok" },
          ...(toolCalls ? { toolCalls } : {}),
          finishReason: toolCalls ? ("tool_calls" as const) : ("stop" as const),
        },
      };
    },
  };
  let started!: () => void;
  const toolStarted = new Promise<void>((r) => (started = r));
  const slow: Tool = {
    name: "slow",
    description: "waits until aborted",
    inputSchema: { type: "object" },
    execute: (_input, ctx) =>
      new Promise((_, reject) => {
        started();
        ctx.signal.addEventListener("abort", () => reject(ctx.signal.reason), { once: true });
      }),
  };

  const runtime = new Runtime({ id: "cancel" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, llm) })
    .use(toolsPlugin({ tools: [slow] }))
    .use(agentPlugin());
  await runtime.start();
  const session = await runtime.get(SESSION).create();

  const turn = session.run("go");
  await toolStarted;
  await session.cancel();
  await assert.rejects(turn);
  assert.equal(session.state, "cancelled");

  const result = await session.run("again");
  assert.equal(result.text, "ok");
  const sent = requests[requests.length - 1]!.messages;
  const callIds = sent.flatMap((m) => (m.role === "assistant" ? m.toolCalls ?? [] : [])).map((c) => c.id);
  const resultIds = new Set(sent.flatMap((m) => (m.role === "tool" ? [m.toolCallId] : [])));
  for (const id of callIds) assert.ok(resultIds.has(id), `missing tool result for ${id}`);
  await runtime.stop();
});
