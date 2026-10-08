import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPlugin, projectContext, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { LLM, type ChatMessage, type LLMRequest, type LLMService } from "@typescript-agent-harness/llm";
import { toolsPlugin } from "@typescript-agent-harness/tools";

const big = (n: number) => "x".repeat(n);

function turn(i: number, toolChars: number): ChatMessage[] {
  const call = { id: `c${i}`, name: "read_file", arguments: { path: `f${i}` } };
  return [
    { role: "user", content: `q${i}` },
    { role: "assistant", toolCalls: [call] },
    { role: "tool", toolCallId: `c${i}`, content: big(toolChars) },
    { role: "assistant", content: `a${i}` },
  ];
}

const history: ChatMessage[] = [
  { role: "system", content: "sys" },
  ...turn(1, 5000),
  ...turn(2, 5000),
  ...turn(3, 5000),
];

test("under budget: unchanged", () => {
  const p = projectContext(history, 1_000_000);
  assert.deepEqual(p.messages, history);
  assert.equal(p.droppedTurns, 0);
  assert.equal(p.elidedToolResults, 0);
});

test("old tool outputs are elided before any turn is dropped; latest turn kept", () => {
  const p = projectContext(history, 6000);
  assert.equal(p.droppedTurns, 0);
  assert.equal(p.elidedToolResults, 2);
  const tools = p.messages.filter((m) => m.role === "tool");
  assert.match(tools[0]!.content, /omitted/);
  assert.match(tools[1]!.content, /omitted/);
  assert.equal(tools[2]!.content.length, 5000);
  assert.ok(p.chars <= 6000);
  assert.equal(history.filter((m) => m.role === "tool")[0]!.content.length, 5000);
});

test("drops oldest whole turns and notes it in the system prompt", () => {
  const p = projectContext(history, 5100);
  assert.equal(p.droppedTurns, 2);
  assert.match(p.messages[0]!.content ?? "", /^sys\n\n\[2 earlier/);
  assert.deepEqual(
    p.messages.filter((m) => m.role === "user").map((m) => m.content),
    ["q3"],
  );
  const callIds = new Set(
    p.messages.flatMap((m) => (m.role === "assistant" ? m.toolCalls ?? [] : [])).map((c) => c.id),
  );
  for (const m of p.messages) if (m.role === "tool") assert.ok(callIds.has(m.toolCallId));
});

test("loop sends the projected context and emits agent.context.trimmed", async () => {
  const seen: LLMRequest[] = [];
  const llm: LLMService = {
    async generate() {
      throw new Error("use stream");
    },
    async *stream(req) {
      seen.push(req);
      yield {
        type: "done" as const,
        response: {
          id: "r",
          model: "stub",
          message: { role: "assistant" as const, content: big(3000) },
          finishReason: "stop" as const,
        },
      };
    },
  };
  const trimmed: unknown[] = [];
  const runtime = new Runtime({ id: "ctx-loop" });
  runtime
    .use({ name: "stub-llm", setup: (ctx) => ctx.provide(LLM, llm) })
    .use(toolsPlugin())
    .use(agentPlugin({ systemPrompt: "sys", contextChars: 2000 }));
  runtime.on("agent.context.trimmed", (e) => {
    trimmed.push(e);
  });
  await runtime.start();
  const session = await runtime.get(SESSION).create();
  await session.run("one");
  await session.run("two");
  await session.run("three");

  assert.equal(session.messages.filter((m) => m.role === "user").length, 3);
  const last = seen[seen.length - 1]!;
  assert.deepEqual(
    last.messages.filter((m) => m.role === "user").map((m) => m.content),
    ["three"],
  );
  assert.ok(trimmed.length > 0);
  await runtime.stop();
});
