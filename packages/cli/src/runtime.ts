import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { agentPlugin, SESSION, type Session } from "@typescript-agent-harness/agent";
import { Runtime } from "@typescript-agent-harness/core";
import { llmPlugin } from "@typescript-agent-harness/llm";
import {
  approvalPlugin,
  permissionsPlugin,
  type ApprovalPluginOptions,
  type PermissionsPluginOptions,
} from "@typescript-agent-harness/permissions";
import {
  listFilesTool,
  readFileTool,
  grepTool,
  toolsPlugin,
  writeFileTool,
  executeCommandTool,
  type Tool,
} from "@typescript-agent-harness/tools";
import type { CliFlags } from "./args.js";
import type { StorageService } from "@typescript-agent-harness/storage";
import { APPROVAL_TOOLS } from "./approve.js";
import { createMarkdownStream, dim, renderMarkdown, useColor } from "./markdown.js";
import { loadProject, ProjectError, type Project } from "./project.js";
import { buildSystemPrompt } from "./prompt.js";
import { formatSessions, resolveSessionRef, toRows } from "./sessions.js";

/**
 * `midLine`: streamed text did not end with a newline, so log lines must break first.
 * `flush`: write any assistant text still buffered for styling; call before printing anything else.
 */
export type StreamFlag = { on: boolean; midLine: boolean; flush: () => void };

/** ~25k tokens of English/code (CJK costs more); leaves room for tool schemas and the reply on 64k-context models. */
export const DEFAULT_CONTEXT_CHARS = 100_000;

export function describeProject(project: Project, systemFile: boolean): string {
  const parts = ["[tah] project:"];
  if (project.instructions !== undefined) {
    parts.push(systemFile ? "AGENTS.md (overridden by --system-file)" : "AGENTS.md");
  }
  parts.push(`tools+${project.tools.length}`, `plugins+${project.plugins.length}`);
  return parts.join(" ");
}

/**
 * `print: false` leaves stdout alone; the caller subscribes to runtime events itself (the TUI).
 * `project` skips reading the project files (a reload has already loaded them).
 */
export async function bootRuntime(
  flags: CliFlags,
  opts: { ask?: ApprovalPluginOptions["ask"]; print?: boolean; project?: Project | undefined } = {},
): Promise<{ runtime: Runtime; streamed: StreamFlag; project: Project | undefined; startup: string }> {
  const ask = flags.yes ? undefined : opts.ask;
  const project = "project" in opts ? opts.project : await loadProject(flags.cwd);
  const role = flags.systemFile
    ? readFileSync(path.resolve(flags.systemFile), "utf8")
    : project?.instructions;
  const builtin = !project?.hasToolsDir || flags.builtinTools;
  const exec = builtin && flags.exec;
  const hasKey = Boolean(
    process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY,
  );
  if (!flags.mock && !hasKey) {
    throw new Error(
      "tah: no DEEPSEEK_API_KEY or OPENAI_API_KEY. Set one in <cwd>/.env or pass --mock.",
    );
  }
  const provider = flags.mock ? "mock" : "openai-compatible";
  const runtime = new Runtime({ id: "tah-cli" });

  const color = useColor();
  const write = (s: string) => {
    process.stdout.write(s);
  };
  const md = color ? createMarkdownStream(write) : { push: write, flush() {} };
  const streamed: StreamFlag = { on: false, midLine: false, flush: () => md.flush() };
  const print = opts.print ?? true;
  if (print) {
    runtime.on("agent.assistant-stream", (e) => {
      const text = (e as { text?: string }).text ?? "";
      if (!text) return;
      streamed.on = true;
      streamed.midLine = color ? false : !text.endsWith("\n");
      md.push(text);
    });
  }
  const log = (line: string) => {
    md.flush();
    if (streamed.midLine) {
      process.stdout.write("\n");
      streamed.midLine = false;
    }
    console.log(color ? dim(line) : line);
  };

  const startup = `[tah] cwd=${flags.cwd} llm=${provider}${flags.persist ? " persist=on" : " persist=off"}${exec ? " exec=on" : " exec=off"}${builtin ? "" : " builtin=off"}${ask ? " approve=on" : " approve=off"}${Number.isFinite(flags.maxSteps) ? ` maxSteps=${flags.maxSteps}` : ""}${flags.systemFile ? ` system=${flags.systemFile}` : ""}${flags.mcpCommand ? " mcp=on" : ""}${flags.allow.length || flags.deny.length ? " perms=on" : ""}${flags.onceMs >= 0 ? ` once=${flags.onceMs}ms` : ""}`;
  if (print && !flags.quiet) {
    log(startup);
    if (project) log(describeProject(project, Boolean(flags.systemFile)));
    runtime.on("llm.request", (e) => {
      const p = e as { model?: string; messageCount: number };
      log(`[llm] ${p.model ?? "?"} messages=${p.messageCount}`);
    });
    runtime.on("llm.retry", (e) => {
      const p = e as { attempt: number; delayMs: number; reason: string };
      log(`[llm] ${p.reason} — retry ${p.attempt} in ${(p.delayMs / 1000).toFixed(1)}s`);
    });
    runtime.on("tool.started", (e) => {
      const p = e as { tool: string };
      log(`[tool] ${p.tool} ...`);
    });
    runtime.on("tool.finished", (e) => {
      const p = e as { tool: string };
      log(`[tool] ${p.tool} done`);
    });
    runtime.on("agent.context.trimmed", (e) => {
      const p = e as { droppedTurns: number; elidedToolResults: number; chars: number };
      log(
        `[ctx] trimmed: ${p.droppedTurns} old turn(s) dropped, ${p.elidedToolResults} tool output(s) omitted, ${p.chars} chars sent (full history kept; /reset for a fresh session)`,
      );
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

  const tools: Tool[] = builtin
    ? [
        listFilesTool(flags.cwd),
        readFileTool(flags.cwd),
        grepTool(flags.cwd),
        writeFileTool(flags.cwd),
        ...(exec ? [executeCommandTool(flags.cwd)] : []),
      ]
    : [];
  for (const { file, tool } of project?.tools ?? []) {
    if (tools.some((t) => t.name === tool.name)) {
      throw new ProjectError(`tah: tools/${file}: tool "${tool.name}" is built in; rename the file or set name`);
    }
  }
  tools.push(...(project?.tools.map((t) => t.tool) ?? []));

  if (exec || flags.allow.length > 0 || flags.deny.length > 0) {
    const perms: PermissionsPluginOptions = {};
    if (flags.allow.length > 0) perms.allow = flags.allow;
    if (flags.deny.length > 0) perms.deny = flags.deny;
    runtime.use(permissionsPlugin(perms));
  }
  if (ask) {
    runtime.use(
      approvalPlugin({
        tools: APPROVAL_TOOLS,
        ask: (call, signal) => {
          md.flush();
          return ask(call, signal);
        },
      }),
    );
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

  runtime.use(
    agentPlugin({
      maxSteps: flags.maxSteps,
      contextChars: DEFAULT_CONTEXT_CHARS,
      systemPrompt: buildSystemPrompt({
        exec,
        mcp: Boolean(flags.mcpCommand),
        builtinTools: builtin,
        ...(role !== undefined ? { role } : {}),
      }),
    }),
  );

  if (flags.onceMs >= 0) {
    const { schedulerPlugin } = await import("@typescript-agent-harness/scheduler");
    runtime.use(schedulerPlugin());
  }

  for (const plugin of project?.plugins ?? []) runtime.use(plugin);

  await runtime.start();
  return { runtime, streamed, project, startup };
}

export async function openChatSession(
  runtime: Runtime,
  flags: CliFlags,
): Promise<{ session: Session; resumed: boolean }> {
  const sessions = runtime.get(SESSION);
  if (flags.session) {
    return { session: await openSessionByRef(runtime, flags.session), resumed: true };
  }
  if (flags.persist) {
    const listed = await sessions.list();
    const latest = listed[0];
    if (latest) {
      const session = await sessions.get(latest.id);
      if (session) return { session, resumed: true };
    }
  }
  const session = await sessions.create();
  return { session, resumed: false };
}

export async function storageOf(runtime: Runtime): Promise<StorageService> {
  const { STORAGE } = await import("@typescript-agent-harness/storage");
  const storage = runtime.context().tryGet(STORAGE);
  if (!storage) {
    throw new Error("sessions are only saved with persist on (drop --no-persist)");
  }
  return storage;
}

/** `ref` is a session id or a number from `tah sessions`. */
export async function openSessionByRef(runtime: Runtime, ref: string): Promise<Session> {
  const id = await resolveSessionRef(await storageOf(runtime), ref);
  const session = id ? await runtime.get(SESSION).get(id) : undefined;
  if (!session) throw new Error(`no session "${ref}" — run tah sessions to list them`);
  return session;
}

export async function describeSessions(runtime: Runtime, currentId?: string): Promise<string> {
  const rows = await (await storageOf(runtime)).listSessions();
  return formatSessions(toRows(rows), currentId);
}

/** For `tah sessions`: reads `<cwd>/.tah/cli.db` without an LLM or API key. */
export async function listSavedSessions(cwd: string): Promise<string> {
  const dbPath = path.join(cwd, ".tah/cli.db");
  if (!existsSync(dbPath)) return `[tah] no saved sessions (${dbPath} does not exist)`;
  const { storagePlugin } = await import("@typescript-agent-harness/storage");
  const runtime = new Runtime({ id: "tah-sessions" });
  runtime.use(storagePlugin({ driver: "sqlite", path: dbPath }));
  await runtime.start();
  try {
    return await describeSessions(runtime);
  } finally {
    await runtime.stop();
  }
}

export async function runOnce(
  runtime: Runtime,
  prompt: string,
  quiet: boolean,
  streamed: StreamFlag,
): Promise<void> {
  const session = await runtime.get(SESSION).create();
  const result = await session.run(prompt);
  endTurn(result, session, quiet, streamed);
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

export type TurnResult = {
  text: string;
  finishReason: string;
};

export function formatStatusLine(
  state: string,
  steps: number,
  finishReason: string,
): string {
  let line = `[tah] state=${state} steps=${steps}`;
  if (finishReason === "max_steps") {
    line += " finishReason=max_steps — step limit hit; say continue to keep going, or pass --max-steps <n>";
  }
  return line;
}

/** LLM rounds recorded since step index `from` — the unit `maxSteps` limits. */
export function turnRounds(session: Pick<Session, "steps">, from: number): number {
  return session.steps.slice(from).filter((s) => s.type === "llm").length;
}

/** `from`: `session.steps.length` before the turn, so the status line counts this turn only. */
export function endTurn(
  result: TurnResult,
  session: Session,
  quiet: boolean,
  streamed: StreamFlag,
  from = 0,
): void {
  const color = useColor();
  if (streamed.on) {
    streamed.flush();
    process.stdout.write("\n");
    streamed.on = false;
    streamed.midLine = false;
    if (!quiet) {
      const status = formatStatusLine(session.state, turnRounds(session, from), result.finishReason);
      console.log(`\n${color ? dim(status) : status}`);
    }
    return;
  }
  printAssistant(result, session, quiet, from);
}

export function printAssistant(
  result: TurnResult,
  session: Session,
  quiet: boolean,
  from = 0,
): void {
  const color = useColor();
  // The max_steps text is written for SDK callers; the status line carries the CLI hint.
  if (result.finishReason !== "max_steps") {
    const text = color ? renderMarkdown(result.text) : result.text;
    console.log(quiet ? text : `\n${text}\n`);
  }
  if (!quiet) {
    const status = formatStatusLine(session.state, turnRounds(session, from), result.finishReason);
    console.log(color ? dim(status) : status);
  }
}
