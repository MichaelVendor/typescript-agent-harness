import assert from "node:assert/strict";
import { test } from "node:test";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { llmPlugin } from "@typescript-agent-harness/llm";
import { toolsPlugin } from "@typescript-agent-harness/tools";

test("session.run emits assistant-stream deltas before finishing", async () => {
  const deltas: string[] = [];
  const runtime = new Runtime({ id: "stream-test" });
  runtime
    .use(llmPlugin({ provider: "mock" }))
    .use(toolsPlugin())
    .use(agentPlugin({ maxSteps: 2 }));
  runtime.on("agent.assistant-stream", (e) => {
    const p = e as { text?: string };
    if (p.text) deltas.push(p.text);
  });
  await runtime.start();
  const session = await runtime.get(SESSION).create();
  const result = await session.run("你好");
  assert.ok(result.text.length > 0);
  assert.equal(deltas.join(""), result.text);
  assert.ok(deltas.length >= 1);
  await runtime.stop();
});
