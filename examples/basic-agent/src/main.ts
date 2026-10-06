/**
 * v0.2 demo: Runtime + LLM + Tools + DefaultLoop
 *
 * 默认 mock。接 DeepSeek：在本目录建 `.env`（见 `.env.example`），或：
 *
 *   DEEPSEEK_API_KEY=sk-... pnpm dev
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentPlugin, SESSION } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { llmPlugin } from "@typescript-agent-harness/llm";
import { listFilesTool, readFileTool, toolsPlugin } from "@typescript-agent-harness/tools";

const exampleRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const workspace = path.resolve(exampleRoot, "../..");

function loadDotEnv(file: string): void {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(exampleRoot, ".env"));

function hasCloudKey(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY);
}

async function main() {
  const runtime = new Runtime({ id: "basic-agent" });
  const provider = hasCloudKey() ? "openai-compatible" : "mock";
  console.log(`[boot] llm provider = ${provider}`);

  runtime.on("llm.request", (e) => {
    const p = e as { model?: string; messageCount: number };
    console.log(`[llm] request model=${p.model ?? "default"} messages=${p.messageCount}`);
  });
  runtime.on("tool.started", (e) => {
    const p = e as { tool: string; callId: string };
    console.log(`[tool] start ${p.tool} (${p.callId})`);
  });
  runtime.on("tool.finished", (e) => {
    const p = e as { tool: string };
    console.log(`[tool] done  ${p.tool}`);
  });
  runtime.on("agent.finished", (e) => {
    const p = e as { finishReason: string };
    console.log(`[agent] finished reason=${p.finishReason}`);
  });

  runtime
    .use(llmPlugin({ provider }))
    .use(
      toolsPlugin({
        tools: [listFilesTool(workspace), readFileTool(workspace)],
      }),
    )
    .use(
      agentPlugin({
        systemPrompt: "You are a workspace agent. Prefer list_files / read_file over guessing.",
      }),
    );

  await runtime.start();

  const sessions = runtime.get(SESSION);
  const session = await sessions.create();
  const result = await session.run("列出当前目录里有什么，并简要说明这个项目是做什么的。");

  console.log("\n--- assistant ---\n");
  console.log(result.text);
  console.log(`\nsteps: ${result.steps.length}  state: ${session.state}`);

  await runtime.stop();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
