import path from "node:path";
import { agentPlugin, SESSION, type Session } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { llmPlugin } from "@typescript-agent-harness/llm";
import { permissionsPlugin, type PermissionsPluginOptions } from "@typescript-agent-harness/permissions";
import {
  listFilesTool,
  readFileTool,
  grepTool,
  toolsPlugin,
  writeFileTool,
  executeCommandTool,
} from "@typescript-agent-harness/tools";
import type { CliFlags } from "./args.js";

export type StreamFlag = { on: boolean };

export async function bootRuntime(
  flags: CliFlags,
): Promise<{ runtime: Runtime; streamed: StreamFlag }> {
  const hasKey = Boolean(
    process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY,
  );
  const provider = flags.mock || !hasKey ? "mock" : "openai-compatible";
  const runtime = new Runtime({ id: "tah-cli" });

  const streamed = { on: false };
  runtime.on("agent.assistant-stream", (e) => {
    const text = (e as { text?: string }).text ?? "";
    if (!text) return;
    streamed.on = true;
    process.stdout.write(text);
  });

  if (!flags.quiet) {
    console.log(
      `[tah] cwd=${flags.cwd} llm=${provider}${flags.persist ? " persist=on" : ""}${flags.exec ? " exec=on" : ""}${flags.mcpCommand ? " mcp=on" : ""}${flags.allow.length || flags.deny.length ? " perms=on" : ""}${flags.onceMs >= 0 ? ` once=${flags.onceMs}ms` : ""}`,
    );
    runtime.on("llm.request", (e) => {
      const p = e as { model?: string; messageCount: number };
      console.log(`[llm] ${p.model ?? "?"} messages=${p.messageCount}`);
    });
    runtime.on("tool.started", (e) => {
      const p = e as { tool: string };
      console.log(`[tool] ${p.tool} ...`);
    });
    runtime.on("tool.finished", (e) => {
      const p = e as { tool: string };
      console.log(`[tool] ${p.tool} done`);
    });
  }

  if (flags.persist) {
    const { storagePlugin } = await import("@typescript-agent-harness/storage");
    runtime.use(
      storagePlugin({
        driver: "sqlite",
        path: path.join(flags.cwd, ".tah/cli.db"),
      }),
    );
  }

  const tools = [
    listFilesTool(flags.cwd),
    readFileTool(flags.cwd),
    grepTool(flags.cwd),
    writeFileTool(flags.cwd),
    ...(flags.exec ? [executeCommandTool(flags.cwd)] : []),
  ];

  if (flags.exec || flags.allow.length > 0 || flags.deny.length > 0) {
    const perms: PermissionsPluginOptions = {};
    if (flags.allow.length > 0) perms.allow = flags.allow;
    if (flags.deny.length > 0) perms.deny = flags.deny;
    runtime.use(permissionsPlugin(perms));
  }

  runtime.use(llmPlugin({ provider })).use(toolsPlugin({ tools }));

  if (flags.mcpCommand) {
    const { mcpPlugin, stdioMcpBackend } = await import("@typescript-agent-harness/mcp");
    runtime.use(
      mcpPlugin({
        backend: stdioMcpBackend({
          command: flags.mcpCommand,
          args: flags.mcpArgs,
          cwd: flags.cwd,
        }),
      }),
    );
  }

  let systemPrompt =
    "You are a workspace coding agent. Prefer list_files, read_file, and grep before answering. Use write_file only when asked to change files.";
  if (flags.exec) {
    systemPrompt += " Use execute_command only when asked to run a program.";
  }
  if (flags.mcpCommand) {
    systemPrompt += " MCP tools from --mcp are also available.";
  }
  runtime.use(agentPlugin({ systemPrompt }));

  if (flags.onceMs >= 0) {
    const { schedulerPlugin } = await import("@typescript-agent-harness/scheduler");
    runtime.use(schedulerPlugin());
  }

  await runtime.start();
  return { runtime, streamed };
}

export async function runOnce(
  runtime: Runtime,
  prompt: string,
  quiet: boolean,
  streamed: StreamFlag,
): Promise<void> {
  const session = await runtime.get(SESSION).create();
  const result = await session.run(prompt);
  endTurn(result.text, session, quiet, streamed);
}

const ONCE_JOB = "tah-run";

export async function runPrompt(
  runtime: Runtime,
  flags: CliFlags,
  streamed: StreamFlag,
): Promise<void> {
  if (flags.onceMs < 0) {
    await runOnce(runtime, flags.prompt, flags.quiet, streamed);
    return;
  }
  const { SCHEDULER } = await import("@typescript-agent-harness/scheduler");
  await new Promise<void>((resolve, reject) => {
    const off = runtime.on("scheduler.job.end", (e) => {
      const p = e as { jobId: string; status: string; error?: string };
      if (p.jobId !== ONCE_JOB) return;
      off();
      if (p.status === "ok") resolve();
      else reject(new Error(p.error ?? "scheduled run failed"));
    });
    runtime.get(SCHEDULER).once(ONCE_JOB, flags.onceMs, () =>
      runOnce(runtime, flags.prompt, flags.quiet, streamed),
    );
  });
}

export function endTurn(
  text: string,
  session: Session,
  quiet: boolean,
  streamed: StreamFlag,
): void {
  if (streamed.on) {
    process.stdout.write("\n");
    streamed.on = false;
    if (!quiet) {
      console.log(`\n[tah] state=${session.state} steps=${session.steps.length}`);
    }
    return;
  }
  printAssistant(text, session, quiet);
}

export function printAssistant(
  text: string,
  session: Session,
  quiet: boolean,
): void {
  console.log(`\n${text}\n`);
  if (!quiet) {
    console.log(`[tah] state=${session.state} steps=${session.steps.length}`);
  }
}
