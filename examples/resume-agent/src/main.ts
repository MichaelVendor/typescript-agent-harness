/**
 * v0.3: persist a session, abort after the first tool checkpoint, resume in a new Runtime.
 *
 *   pnpm demo:resume
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { llmPlugin } from "@typescript-agent-harness/llm";
import { storagePlugin } from "@typescript-agent-harness/storage";
import { listFilesTool, readFileTool, toolsPlugin } from "@typescript-agent-harness/tools";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
const dbPath = path.join(repoRoot, ".tah/resume-demo.db");

async function boot() {
  const runtime = new Runtime({ id: "resume-demo" });
  runtime
    .use(storagePlugin({ driver: "sqlite", path: dbPath }))
    .use(llmPlugin({ provider: "mock" }))
    .use(
      toolsPlugin({
        tools: [listFilesTool(repoRoot), readFileTool(repoRoot)],
      }),
    )
    .use(agentPlugin({ maxSteps: 8 }));
  await runtime.start();
  return runtime;
}

async function main() {
  const first = await boot();
  const session = await first.get(SESSION).create();
  console.log(`[boot] session ${session.id}`);
  console.log(`[boot] db ${dbPath}`);

  let crashed = false;
  first.on("storage.checkpoint", (e) => {
    const p = e as { stepType?: string | null };
    if (!crashed && p.stepType === "tool") {
      crashed = true;
      throw new Error("simulated crash after first tool checkpoint");
    }
  });

  try {
    await session.run("列出当前目录并说明这个项目是做什么的。");
    throw new Error("expected crash before the run finished");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("simulated crash")) throw err;
    console.log(`[crash] ${message}`);
    console.log(`[crash] messages=${session.messages.length} state=${session.state}`);
  }

  await first.stop();

  const second = await boot();
  const restored = await second.get(SESSION).get(session.id);
  if (!restored) throw new Error(`session not found after restart: ${session.id}`);
  console.log(
    `[resume] ${restored.id} state=${restored.state} messages=${restored.messages.length}`,
  );
  const result = await restored.resume();
  console.log("\n--- assistant ---\n");
  console.log(result.text);
  console.log(`\nsteps: ${result.steps.length}  state: ${restored.state}`);
  await second.stop();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
