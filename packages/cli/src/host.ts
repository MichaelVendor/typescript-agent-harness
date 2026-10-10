import { SESSION, type RunResult, type Session, type SessionService } from "@typescript-agent-harness/agent";
import type { Runtime } from "@typescript-agent-harness/core";
import type { ChatMessage } from "@typescript-agent-harness/llm";
import type { ApprovalAnswer, ApprovalPluginOptions } from "@typescript-agent-harness/permissions";
import type { CliFlags } from "./args.js";
import { loadProject, type Project } from "./project.js";
import {
  bootRuntime,
  describeProject,
  openChatSession,
  openSessionByRef,
  storageOf,
  turnRounds,
} from "./runtime.js";
import { toRows, type SessionRow } from "./sessions.js";
import { watchProject } from "./watch.js";

export type HistoryItem =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string }
  | { role: "tool"; callId: string; tool: string; summary: string; ok: boolean; result: string };

export type SessionEvent = {
  type: "session";
  id: string;
  resumed: boolean;
  history: HistoryItem[];
  hiddenTurns: number;
};

/** Every event is plain JSON, so `tah serve` can stream them unchanged. */
export type HostEvent =
  | SessionEvent
  | { type: "user"; text: string }
  | { type: "text"; delta: string }
  | { type: "tool.start"; callId: string; tool: string; summary: string }
  | { type: "tool.end"; callId: string; tool: string; summary: string; ok: boolean; result: string }
  | { type: "approval"; id: string; tool: string; input: unknown }
  | { type: "approval.end"; id: string; answer: ApprovalAnswer }
  | { type: "notice"; text: string }
  | { type: "turn.end"; state: string; finishReason: string; rounds: number; model?: string }
  | { type: "turn.error"; cancelled: boolean; message: string };

export type ChatHost = {
  readonly sessionId: string;
  readonly approve: boolean;
  on(listener: (event: HostEvent) => void): () => void;
  /** Emits the startup notices and the first `session` event; call after subscribing. */
  open(): Promise<void>;
  /** The current session as a `session` event, without emitting it. */
  snapshot(): SessionEvent;
  send(text: string): Promise<void>;
  /** After `turn.end` with `finishReason: "max_steps"`: run the same turn with a fresh step budget. */
  continueTurn(): Promise<void>;
  cancel(): void;
  answer(id: string, answer: ApprovalAnswer): void;
  reset(): Promise<void>;
  resume(ref: string): Promise<void>;
  fork(turns?: number): Promise<void>;
  listSessions(): Promise<SessionRow[]>;
  close(): Promise<void>;
};

const HISTORY_TURNS = 3;
const SUMMARY_WIDTH = 60;

function clip(s: string, width = SUMMARY_WIDTH): string {
  const line = s.replace(/\s+/g, " ").trim();
  return line.length > width ? `${line.slice(0, width - 1)}…` : line;
}

export function toolSummary(tool: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>;
  if (tool === "read_file" || tool === "write_file") return clip(String(a.path ?? ""));
  if (tool === "list_files") return clip(String(a.directory ?? "."));
  if (tool === "grep") return clip(`${String(a.pattern ?? "")}${a.directory ? ` in ${String(a.directory)}` : ""}`);
  if (tool === "execute_command") {
    const args = Array.isArray(a.args) ? a.args.map(String) : [];
    return clip([String(a.program ?? ""), ...args].join(" "));
  }
  return clip(JSON.stringify(input ?? {}));
}

function errorText(output: unknown): string {
  if (typeof output === "string") return clip(output);
  const error = (output as { error?: unknown } | undefined)?.error;
  return clip(typeof error === "string" ? error : JSON.stringify(output ?? "failed"));
}

export function toolResult(tool: string, ok: boolean, output: unknown): string {
  if (!ok) return errorText(output);
  const o = (output ?? {}) as Record<string, unknown>;
  if (tool === "read_file" && typeof o.content === "string") {
    return `${o.content.split("\n").length} lines${o.truncated ? " (truncated)" : ""}`;
  }
  if (tool === "list_files" && Array.isArray(o.entries)) return `${o.entries.length} entries`;
  if (tool === "write_file" && typeof o.bytes === "number") return `${o.bytes} bytes`;
  if (tool === "grep" && Array.isArray(o.matches)) {
    return `${o.matches.length} matches${o.truncated ? " (truncated)" : ""}`;
  }
  if (tool === "execute_command") return o.timedOut ? "timed out" : `exit ${String(o.exitCode)}`;
  return "done";
}

/** The last `turns` user turns as display items; `hiddenTurns` counts the earlier ones. */
export function historyOf(
  messages: ChatMessage[],
  turns = HISTORY_TURNS,
): { history: HistoryItem[]; hiddenTurns: number } {
  const starts = messages.flatMap((m, i) => (m.role === "user" ? [i] : []));
  const hiddenTurns = Math.max(0, starts.length - turns);
  const from = starts[hiddenTurns] ?? messages.length;
  const outputs = new Map<string, string>();
  for (const m of messages) if (m.role === "tool") outputs.set(m.toolCallId, m.content);

  const history: HistoryItem[] = [];
  for (const m of messages.slice(from)) {
    if (m.role === "user") history.push({ role: "user", text: m.content });
    if (m.role !== "assistant") continue;
    if (m.content) history.push({ role: "assistant", text: m.content });
    for (const call of m.toolCalls ?? []) {
      let output: unknown = outputs.get(call.id);
      try {
        output = JSON.parse(String(output));
      } catch {}
      const ok = !(output && typeof output === "object" && "error" in output);
      history.push({
        role: "tool",
        callId: call.id,
        tool: call.name,
        summary: toolSummary(call.name, call.arguments),
        ok,
        result: toolResult(call.name, ok, output),
      });
    }
  }
  return { history, hiddenTurns };
}

/**
 * Each `ask` becomes an `approval` event that waits for `answer`; an aborted turn answers "no".
 * Every settled question emits `approval.end`, so all front ends drop the card.
 */
export function approvalQueue(emit: (event: HostEvent) => void): {
  ask: ApprovalPluginOptions["ask"];
  answer(id: string, answer: ApprovalAnswer): void;
  rejectAll(): void;
} {
  const pending = new Map<string, (answer: ApprovalAnswer) => void>();
  let count = 0;
  return {
    ask: (call, signal) =>
      new Promise((resolve) => {
        if (signal?.aborted) return resolve("no");
        const id = `approval_${++count}`;
        const settle = (answer: ApprovalAnswer) => {
          if (!pending.delete(id)) return;
          resolve(answer);
          emit({ type: "approval.end", id, answer });
        };
        pending.set(id, settle);
        signal?.addEventListener("abort", () => settle("no"), { once: true });
        emit({ type: "approval", id, tool: call.name, input: call.arguments ?? null });
      }),
    answer(id, answer) {
      pending.get(id)?.(answer);
    },
    rejectAll() {
      for (const settle of [...pending.values()]) settle("no");
    },
  };
}

/** "always" outlives a reload: the approval plugin's own memory goes away with its runtime. */
export function rememberAlways(ask: ApprovalPluginOptions["ask"]): ApprovalPluginOptions["ask"] {
  const always = new Set<string>();
  return async (call, signal) => {
    if (always.has(call.name)) return "yes";
    const answer = await ask(call, signal);
    if (answer === "always") always.add(call.name);
    return answer;
  };
}

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^tah: /, "");

/** `historyTurns`: how many recent turns `session` events carry (default 3, for a terminal). */
export async function createChatHost(
  flags: CliFlags,
  opts: { historyTurns?: number } = {},
): Promise<ChatHost> {
  const historyTurns = opts.historyTurns ?? HISTORY_TURNS;
  const listeners = new Set<(event: HostEvent) => void>();
  const emit = (event: HostEvent) => {
    for (const listener of listeners) listener(event);
  };
  const approvals = approvalQueue(emit);
  const rejectPending = () => approvals.rejectAll();

  /** A call rejected at approval never starts, so its summary is kept from the question. */
  const summaries = new Map<string, string>();
  const ask = rememberAlways((call, signal) => {
    summaries.set(call.id, toolSummary(call.name, call.arguments));
    return approvals.ask(call, signal);
  });
  const toolEnd = (callId: string, tool: string, ok: boolean, output: unknown) => {
    const summary = summaries.get(callId) ?? "";
    summaries.delete(callId);
    emit({ type: "tool.end", callId, tool, summary, ok, result: toolResult(tool, ok, output) });
  };

  let streamedText = false;
  let model: string | undefined;
  const attach = (runtime: Runtime) => {
    runtime.on("agent.assistant-stream", (e) => {
      const delta = (e as { text?: string }).text ?? "";
      if (!delta) return;
      streamedText = true;
      emit({ type: "text", delta });
    });
    runtime.on("llm.request", (e) => {
      model = (e as { model?: string }).model ?? model;
    });
    runtime.on("tool.started", (e) => {
      const p = e as { callId: string; tool: string; input: unknown };
      const summary = toolSummary(p.tool, p.input);
      summaries.set(p.callId, summary);
      emit({ type: "tool.start", callId: p.callId, tool: p.tool, summary });
    });
    runtime.on("tool.finished", (e) => {
      const p = e as { callId: string; tool: string; output: unknown };
      toolEnd(p.callId, p.tool, true, p.output);
    });
    runtime.on("tool.failed", (e) => {
      const p = e as { callId: string; tool: string; error: unknown };
      toolEnd(p.callId, p.tool, false, p.error);
    });
    if (!flags.quiet) {
      runtime.on("llm.retry", (e) => {
        const p = e as { attempt: number; delayMs: number; reason: string };
        emit({ type: "notice", text: `[llm] ${p.reason} — retry ${p.attempt} in ${(p.delayMs / 1000).toFixed(1)}s` });
      });
      runtime.on("agent.context.trimmed", (e) => {
        const p = e as { droppedTurns: number; elidedToolResults: number; chars: number };
        emit({
          type: "notice",
          text: `[ctx] trimmed: ${p.droppedTurns} old turn(s) dropped, ${p.elidedToolResults} tool output(s) omitted, ${p.chars} chars sent (full history kept; /reset for a fresh session)`,
        });
      });
    }
  };

  let runtime: Runtime;
  let sessions: SessionService;
  let project: Project | undefined;
  const boot = async (opts: { project?: Project | undefined } = {}) => {
    const booted = await bootRuntime(flags, { ask, print: false, ...opts });
    runtime = booted.runtime;
    sessions = runtime.get(SESSION);
    project = booted.project;
    attach(runtime);
    return booted.startup;
  };
  const startup = await boot();

  let session: Session;
  let busy = false;
  const idle = () => {
    if (busy) throw new Error("a turn is running — wait for it or press Ctrl+C");
  };

  /** Load the files first, so most mistakes leave the running runtime untouched; then swap. */
  async function reload(): Promise<void> {
    let next: Project | undefined;
    try {
      next = await loadProject(flags.cwd);
    } catch (err) {
      emit({ type: "notice", text: `[tah] reload failed — still using the previous version: ${reason(err)}` });
      return;
    }
    const previous = project;
    const id = session.id;
    await runtime.stop();
    let failure: unknown;
    try {
      await boot({ project: next });
    } catch (err) {
      failure = err;
      await boot({ project: previous });
    }
    session = await openSessionByRef(runtime, id);
    emit({
      type: "notice",
      text:
        failure === undefined
          ? describeProject(project!, Boolean(flags.systemFile)).replace("[tah] project:", "[tah] reloaded:")
          : `[tah] reload failed — still using the previous version: ${reason(failure)}`,
    });
  }

  const changed = new Set<string>();
  let reloading: Promise<void> | undefined;
  const reloadWhenIdle = () => {
    if (busy || reloading || changed.size === 0) return;
    changed.clear();
    reloading = reload()
      .catch((err) => emit({ type: "notice", text: `[tah] reload failed — restart tah: ${reason(err)}` }))
      .finally(() => {
        reloading = undefined;
        reloadWhenIdle();
      });
  };
  /** Commands wait out a reload instead of failing as busy. */
  const settled = async () => {
    while (reloading) await reloading;
  };
  let stopWatching = () => {};
  const watch = () => {
    if (!flags.watch || !project) return;
    stopWatching = watchProject(flags.cwd, (files) => {
      if (!flags.persist) {
        emit({ type: "notice", text: `[tah] ${files.join(", ")} changed — restart to apply (persist is off)` });
        return;
      }
      for (const file of files) changed.add(file);
      reloadWhenIdle();
    });
  };
  const sessionEvent = (resumed: boolean): SessionEvent => ({
    type: "session",
    id: session.id,
    resumed,
    ...historyOf(session.messages, historyTurns),
  });
  const showSession = (resumed: boolean) => emit(sessionEvent(resumed));

  async function turn(run: () => Promise<RunResult>, text?: string): Promise<void> {
    idle();
    busy = true;
    if (text !== undefined) emit({ type: "user", text });
    streamedText = false;
    const from = session.steps.length;
    let event: HostEvent;
    try {
      const result = await run();
      if (!streamedText && result.text && result.finishReason !== "max_steps") {
        emit({ type: "text", delta: result.text });
      }
      event = {
        type: "turn.end",
        state: session.state,
        finishReason: result.finishReason,
        rounds: turnRounds(session, from),
        ...(model ? { model } : {}),
      };
    } catch (err) {
      rejectPending();
      event = {
        type: "turn.error",
        cancelled: session.state === "cancelled",
        message: err instanceof Error ? err.message : String(err),
      };
    }
    busy = false;
    emit(event);
    reloadWhenIdle();
  }
  const ready = <T>(command: () => Promise<T>): Promise<T> => (reloading ? settled().then(command) : command());

  const host: ChatHost = {
    get sessionId() {
      return session.id;
    },
    approve: !flags.yes,
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async open() {
      if (!flags.quiet) {
        emit({ type: "notice", text: startup });
        if (project) emit({ type: "notice", text: describeProject(project, Boolean(flags.systemFile)) });
      }
      const opened = await openChatSession(runtime, flags);
      session = opened.session;
      showSession(opened.resumed);
      watch();
    },
    snapshot: () => sessionEvent(true),
    send: (text) => ready(() => turn(() => session.run(text), text)),
    continueTurn: () => ready(() => turn(() => session.resume())),
    cancel() {
      rejectPending();
      if (busy) void session.cancel();
    },
    answer: approvals.answer,
    reset: () =>
      ready(async () => {
        idle();
        session = await sessions.create();
        showSession(false);
      }),
    resume: (ref) =>
      ready(async () => {
        idle();
        session = await openSessionByRef(runtime, ref);
        showSession(true);
      }),
    fork: (turns) =>
      ready(async () => {
        idle();
        session = await sessions.fork(session.id, turns === undefined ? {} : { turns });
        showSession(true);
      }),
    listSessions: () => ready(async () => toRows(await (await storageOf(runtime)).listSessions())),
    async close() {
      stopWatching();
      await settled();
      rejectPending();
      await runtime.stop();
    },
  };
  return host;
}
