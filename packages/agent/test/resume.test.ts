import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { llmPlugin } from "@typescript-agent-harness/llm";
import { storagePlugin } from "@typescript-agent-harness/storage";
import { listFilesTool, readFileTool, toolsPlugin } from "@typescript-agent-harness/tools";

async function boot(dbPath: string, workspace: string, maxSteps = 8) {
  const runtime = new Runtime({ id: "resume-test" });
  runtime
    .use(storagePlugin({ driver: "sqlite", path: dbPath }))
    .use(llmPlugin({ provider: "mock" }))
    .use(
      toolsPlugin({
        tools: [listFilesTool(workspace), readFileTool(workspace)],
      }),
    )
    .use(agentPlugin({ maxSteps }));
  await runtime.start();
  return runtime;
}

test("reopened session uses the current maxSteps, not the stored one", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tah-resume-"));
  const dbPath = path.join(root, "data.db");

  const first = await boot(dbPath, root, 2);
  const { id } = await first.get(SESSION).create();
  await first.stop();

  const second = await boot(dbPath, root, 5);
  const restored = await second.get(SESSION).get(id);
  assert.equal(restored?.maxSteps, 5);
  await second.stop();
});

test("resume continues after a crash following the first tool checkpoint", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "tah-resume-"));
  const workspace = path.join(root, "ws");
  mkdirSync(workspace);
  writeFileSync(
    path.join(workspace, "README.md"),
    "# typescript-agent-harness\n\nThis is a TypeScript Agent Runtime used in tests.\n",
  );
  const dbPath = path.join(root, "data.db");

  const first = await boot(dbPath, workspace);
  const session = await first.get(SESSION).create();
  let crashed = false;
  first.on("storage.checkpoint", (e) => {
    const p = e as { stepType?: string | null };
    if (!crashed && p.stepType === "tool") {
      crashed = true;
      throw new Error("simulated crash after first tool checkpoint");
    }
  });

  await assert.rejects(
    () => session.run("列出当前目录并说明这个项目"),
    /simulated crash/,
  );
  const sessionId = session.id;
  await first.stop();

  const second = await boot(dbPath, workspace);
  const restored = await second.get(SESSION).get(sessionId);
  assert.ok(restored);
  assert.equal(restored.state, "failed");
  const result = await restored.resume();
  assert.ok(result.text.length > 0);
  assert.equal(restored.state, "completed");
  await second.stop();
});
