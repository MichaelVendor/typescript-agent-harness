/**
 * v0.4: permissions, MCP-as-Tool, subagent-as-Tool, scheduler.
 *
 *   pnpm demo:multi
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { agentPlugin, SESSION, subagentTool } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { llmPlugin } from "@typescript-agent-harness/llm";
import { inProcessPingBackend, mcpPlugin } from "@typescript-agent-harness/mcp";
import { permissionsPlugin } from "@typescript-agent-harness/permissions";
import { SCHEDULER, schedulerPlugin } from "@typescript-agent-harness/scheduler";
import {
  listFilesTool,
  readFileTool,
  TOOLS,
  toolsPlugin,
  writeFileTool,
  type ToolContext,
} from "@typescript-agent-harness/tools";

const repoRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function manualCtx(runtime: Runtime, callId: string): ToolContext {
  return {
    sessionId: "manual",
    callId,
    signal: new AbortController().signal,
    runtime: runtime.context(),
  };
}

async function main() {
  const runtime = new Runtime({ id: "multi-agent" });

  runtime.on("permission.denied", (e) => {
    const p = e as { tool: string; reason: string };
    console.log(`[perm] denied ${p.tool}: ${p.reason}`);
  });
  runtime.on("permission.granted", (e) => {
    const p = e as { tool: string };
    console.log(`[perm] granted ${p.tool}`);
  });
  runtime.on("scheduler.job.end", (e) => {
    const p = e as { jobId: string; status: string };
    console.log(`[sched] ${p.jobId} ${p.status}`);
  });

  runtime
    .use(permissionsPlugin({ deny: ["write_file"] }))
    .use(
      toolsPlugin({
        tools: [
          listFilesTool(repoRoot),
          readFileTool(repoRoot),
          writeFileTool(repoRoot),
          subagentTool(),
        ],
      }),
    )
    .use(mcpPlugin({ backend: inProcessPingBackend() }))
    .use(llmPlugin({ provider: "mock" }))
    .use(agentPlugin({ maxSteps: 8 }))
    .use(schedulerPlugin());

  await runtime.start();

  const tools = runtime.get(TOOLS);
  console.log(`[boot] visible tools: ${tools.list().map((t) => t.name).join(", ")}`);

  const denied = await tools.execute(
    {
      id: "manual-write",
      name: "write_file",
      arguments: { path: "SHOULD_NOT_EXIST.txt", content: "nope" },
    },
    manualCtx(runtime, "manual-write"),
  );
  console.log(`[boot] write_file ok=${denied.ok} error=${JSON.stringify(denied.output)}`);

  const ping = await tools.execute(
    { id: "manual-ping", name: "ping", arguments: { text: "harness" } },
    manualCtx(runtime, "manual-ping"),
  );
  console.log(`[boot] mcp ping ok=${ping.ok} output=${JSON.stringify(ping.output)}`);

  const child = await tools.execute(
    {
      id: "manual-sub",
      name: "run_subagent",
      arguments: { task: "列出仓库根目录并一句话说明项目。" },
    },
    manualCtx(runtime, "manual-sub"),
  );
  const childOut = child.output as { text?: string; sessionId?: string };
  console.log(`[boot] subagent ${childOut.sessionId} ok=${child.ok}`);
  console.log(`--- subagent ---\n${childOut.text ?? ""}\n`);

  const scheduled = new Promise<void>((resolve, reject) => {
    const off = runtime.on("scheduler.job.end", (e) => {
      const p = e as { jobId: string; status: string; error?: string };
      if (p.jobId !== "tick") return;
      off();
      if (p.status === "ok") resolve();
      else reject(new Error(p.error ?? "scheduled job failed"));
    });
  });

  runtime.get(SCHEDULER).once("tick", 20, async () => {
    const session = await runtime.get(SESSION).create();
    const result = await session.run("列出当前目录并说明这个项目是做什么的。");
    console.log(`--- scheduled session ${session.id} ---\n${result.text}\n`);
  });

  await scheduled;
  await runtime.stop();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
