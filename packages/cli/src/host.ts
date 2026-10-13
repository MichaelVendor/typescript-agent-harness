import os from "node:os";
import { SESSION, type RunResult, type Session, type SessionService } from "@typescript-agent-harness/agent";
import type { Runtime } from "@typescript-agent-harness/core";
import type { ChatMessage } from "@typescript-agent-harness/llm";
import type { ApprovalAnswer, ApprovalPluginOptions } from "@typescript-agent-harness/permissions";
import type { Todo } from "@typescript-agent-harness/tools";
import type { CliFlags } from "./args.js";
import { composeAttachmentPrompt, parseUserContent, userContentForVision } from "./attachments/compose.js";
import {
  checkMessageLimits,
  createAttachmentStore,
  type AttachmentMeta,
  type AttachmentRef,
  type AttachmentStore,
} from "./attachments/store.js";
import { loadProject, type Project } from "./project.js";
import {
  bootRuntime,
  compactedNotice,
  compactFailedNotice,
  describeProject,
  openChatSession,
  openSessionByRef,
  storageOf,
  turnRounds,
} from "./runtime.js";
import { setSessionFlag, type SessionFlag } from "./session-flags.js";
import { setSessionTitle } from "./session-titles.js";
import { displayUserText, toRows, type SessionRow } from "./sessions.js";
import { applySlashSkills, stripSkillInjection } from "./skills/slash.js";
import type { SkillSummary } from "./skills/types.js";
import { watchProject } from "./watch.js";

export type HistoryItem =
  | { role: "user"; text: string; attachments?: AttachmentMeta[] }
  | { role: "assistant"; text: string }
  | { role: "tool"; callId: string; tool: string; summary: string; ok: boolean; result: string };

export type SessionEvent = {
  type: "session";
  id: string;
  resumed: boolean;
  history: HistoryItem[];
  hiddenTurns: number;
  /** The latest `todo_write` list in the whole session, if any. */
  todos?: Todo[];
};

/** Every event is plain JSON, so `tah serve` can stream them unchanged. */
export type HostEvent =
  | SessionEvent
  | { type: "user"; text: string; attachments?: AttachmentMeta[] }
  | { type: "text"; delta: string }
  | { type: "tool.start"; callId: string; tool: string; summary: string }
  | { type: "tool.end"; callId: string; tool: string; summary: string; ok: boolean; result: string }
  | { type: "todos"; todos: Todo[] }
  | { type: "approval"; id: string; tool: string; input: unknown }
  | { type: "approval.end"; id: string; answer: ApprovalAnswer }
  | { type: "notice"; text: string; error?: boolean }
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
  send(text: string, attachmentIds?: string[]): Promise<void>;
  /** Persist an uploaded file; used by `tah serve`. */
  saveAttachment(input: { name: string; mime: string; data: Buffer }): AttachmentRef;
  /** After `turn.end` with `finishReason: "max_steps"`: run the same turn with a fresh step budget. */
  continueTurn(): Promise<void>;
  /** Summarizes the conversation so far into one message the model sees instead; runs as a turn (cancel stops it). */
  compact(): Promise<void>;
  cancel(): void;
  answer(id: string, answer: ApprovalAnswer): void;
  reset(): Promise<void>;
  resume(ref: string): Promise<void>;
  fork(turns?: number): Promise<void>;
  listSessions(): Promise<SessionRow[]>;
  /** Set or clear a custom sidebar title; returns the stored title (undefined if cleared). */
  renameSession(id: string, title: string): Promise<string | undefined>;
  /** Pin / archive a session in the sidebar; archiving also unpins. */
  setSessionFlag(id: string, flag: SessionFlag, on: boolean): Promise<void>;
  /** Rebuilds the runtime (e.g. after the model in settings changed) and keeps the session; needs persist. */
  reload(): Promise<void>;
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
  if (tool === "read_file" || tool === "write_file" || tool === "edit_file") return clip(String(a.path ?? ""));
  if (tool === "list_files") return clip(String(a.directory ?? "."));
  if (tool === "grep") return clip(`${String(a.pattern ?? "")}${a.directory ? ` in ${String(a.directory)}` : ""}`);
  if (tool === "web_search") return clip(String(a.query ?? ""));
  if (tool === "web_fetch") return clip(String(a.url ?? ""));
  if (tool === "browser_open" || tool === "browser_navigate") return clip(String(a.url ?? ""));
  if (tool.startsWith("browser_") && typeof a.element === "string") return clip(a.element);
  if (tool === "execute_command") {
    const args = Array.isArray(a.args) ? a.args.map(String) : [];
    return clip([String(a.program ?? ""), ...args].join(" "));
  }
  if (tool === "todo_write" && Array.isArray(a.todos)) {
    const current = (a.todos as Partial<Todo>[]).find((t) => t?.status === "in_progress");
    return clip(current?.content ?? `${a.todos.length} tasks`);
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
  if (tool === "edit_file" && typeof o.replacements === "number") {
    return `${o.replacements} replacement${o.replacements === 1 ? "" : "s"}`;
  }
  if (tool === "grep" && Array.isArray(o.matches)) {
    return `${o.matches.length} matches${o.truncated ? " (truncated)" : ""}`;
  }
  if (tool === "execute_command") return o.timedOut ? "timed out" : `exit ${String(o.exitCode)}`;
  if (tool === "web_search" && Array.isArray(o.results)) return `${o.results.length} results`;
  if (tool === "web_fetch" && typeof o.content === "string") {
    return `${o.content.length} chars${o.truncated ? " (truncated)" : ""}`;
  }
  if (tool === "todo_write" && Array.isArray(o.todos)) {
    return `${(o.todos as Todo[]).filter((t) => t.status === "completed").length}/${o.todos.length} done`;
  }
  if (tool === "browser_open") return o.opened ? "opened" : "already open";
  if (tool.startsWith("browser_") && typeof output === "string") {
    return /- Page Title: (.+)/.exec(output)?.[1]?.trim() || `${output.length} chars`;
  }
  return "done";
}

/** The list from the last successful `todo_write`; tool outputs are stored as JSON text. */
export function todosOf(messages: ChatMessage[]): Todo[] | undefined {
  const todoCalls = new Set<string>();
  let todos: Todo[] | undefined;
  for (const m of messages) {
    if (m.role === "assistant") {
      for (const call of m.toolCalls ?? []) if (call.name === "todo_write") todoCalls.add(call.id);
    }
    if (m.role !== "tool" || !todoCalls.has(m.toolCallId)) continue;
    try {
      const output = JSON.parse(String(m.content)) as { todos?: unknown };
      if (Array.isArray(output.todos)) todos = output.todos as Todo[];
    } catch {}
  }
  return todos;
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
    if (m.role === "user") {
      const raw =
        typeof m.content === "string"
          ? m.content
          : m.content.filter((p) => p.type === "text").map((p) => p.text).join("\n");
      const parsed = parseUserContent(raw);
      history.push({
        role: "user",
        text: displayUserText(stripSkillInjection(parsed.text)),
        ...(parsed.attachments.length ? { attachments: parsed.attachments } : {}),
      });
    }
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

/** Model prompt keeps the attachment text; a slash skill is appended and never shown as the user line. */
function promptWithSkills(
  prompt: string,
  display: string,
  skills: SkillSummary[],
): { modelText: string; suffix: string } {
  try {
    const suffix = applySlashSkills(display, skills).modelSuffix;
    if (!suffix) return { modelText: prompt, suffix: "" };
    return { modelText: `${prompt}\n\n${suffix}`, suffix };
  } catch {
    return { modelText: prompt, suffix: "" };
  }
}

/** `historyTurns`: how many recent turns `session` events carry (default 3, for a terminal). */
export async function createChatHost(
  flags: CliFlags,
  opts: { historyTurns?: number; homeDir?: string } = {},
): Promise<ChatHost> {
  const historyTurns = opts.historyTurns ?? HISTORY_TURNS;
  const homeDir = opts.homeDir ?? os.homedir();
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
      const todos = (p.output as { todos?: unknown } | undefined)?.todos;
      if (p.tool === "todo_write" && Array.isArray(todos)) emit({ type: "todos", todos: todos as Todo[] });
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
      runtime.on("agent.context.compacted", (e) => {
        emit({ type: "notice", text: compactedNotice(e as { turns: number; chars: number }) });
      });
      runtime.on("agent.context.compact-failed", (e) => {
        emit({ type: "notice", text: compactFailedNotice(e as { error: string }), error: true });
      });
    }
  };

  let runtime: Runtime;
  let sessions: SessionService;
  let project: Project | undefined;
  let skills: SkillSummary[] = [];
  let skillWarnings: string[] = [];
  const boot = async (opts: { project?: Project | undefined } = {}) => {
    const booted = await bootRuntime(flags, { ask, print: false, homeDir, ...opts });
    runtime = booted.runtime;
    sessions = runtime.get(SESSION);
    project = booted.project;
    skills = booted.skills;
    skillWarnings = booted.warnings;
    attach(runtime);
    return booted.startup;
  };
  const startup = await boot();
  const attachments: AttachmentStore = createAttachmentStore(flags.cwd);

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
      emit({ type: "notice", text: `[tah] reload failed — still using the previous version: ${reason(err)}`, error: true });
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
    const reloaded = project
      ? describeProject(project, Boolean(flags.systemFile)).replace("[tah] project:", "[tah] reloaded:")
      : "[tah] reloaded";
    emit(
      failure === undefined
        ? { type: "notice", text: reloaded }
        : { type: "notice", text: `[tah] reload failed — still using the previous version: ${reason(failure)}`, error: true },
    );
    if (failure === undefined) {
      for (const w of skillWarnings) emit({ type: "notice", text: `[tah] ${w}` });
    }
  }

  const changed = new Set<string>();
  let reloading: Promise<void> | undefined;
  const reloadWhenIdle = () => {
    if (busy || reloading || changed.size === 0) return;
    changed.clear();
    reloading = reload()
      .catch((err) => emit({ type: "notice", text: `[tah] reload failed — restart tah: ${reason(err)}`, error: true }))
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
  let reloadedAt = 0;
  const watch = () => {
    if (!flags.watch) return;
    stopWatching = watchProject(flags.cwd, (files) => {
      // The watcher reports a write ~debounce ms late; an explicit reload just before already read it.
      if (Date.now() - reloadedAt < 1000) return;
      if (!flags.persist) {
        emit({ type: "notice", text: `[tah] ${files.join(", ")} changed — restart to apply (persist is off)` });
        return;
      }
      for (const file of files) changed.add(file);
      reloadWhenIdle();
    }, 200, { homeSkillsDir: homeDir, skillsOnly: !project });
  };
  const sessionEvent = (resumed: boolean): SessionEvent => {
    const todos = todosOf(session.messages);
    return {
      type: "session",
      id: session.id,
      resumed,
      ...historyOf(session.messages, historyTurns),
      ...(todos ? { todos } : {}),
    };
  };
  const showSession = (resumed: boolean) => emit(sessionEvent(resumed));

  async function turn(
    run: () => Promise<RunResult>,
    user?: { text: string; attachments?: AttachmentMeta[] },
  ): Promise<void> {
    idle();
    busy = true;
    if (user !== undefined) {
      emit({
        type: "user",
        text: user.text,
        ...(user.attachments?.length ? { attachments: user.attachments } : {}),
      });
    }
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
        for (const w of skillWarnings) emit({ type: "notice", text: `[tah] ${w}` });
      }
      const opened = await openChatSession(runtime, flags);
      session = opened.session;
      showSession(opened.resumed);
      watch();
    },
    snapshot: () => sessionEvent(true),
    saveAttachment(input) {
      return attachments.save(input);
    },
    send: (text, attachmentIds = []) =>
      ready(async () => {
        const refs = attachmentIds.length ? attachments.getMany(attachmentIds) : [];
        checkMessageLimits(refs);
        const display = text.trim();
        if (!display && refs.length === 0) throw new Error("message is empty");
        const meta: AttachmentMeta[] = refs.map(({ id, kind, name, mime, bytes, sha256 }) => ({
          id,
          kind,
          name,
          mime,
          bytes,
          sha256,
        }));
        const prompt = composeAttachmentPrompt(display, refs);
        const { modelText, suffix } = promptWithSkills(prompt, display, skills);
        const run = async () => {
          if (flags.vision && refs.some((r) => r.kind === "image")) {
            const images = await Promise.all(
              refs.filter((r) => r.kind === "image").map(async (r) => ({
                mime: r.mime,
                data: await attachments.readBytes(r.id),
              })),
            );
            const content = userContentForVision(display, refs, images);
            if (suffix) {
              const first = content[0];
              if (first && first.type === "text") {
                content[0] = { type: "text", text: `${first.text}\n\n${suffix}` };
              }
            }
            return session.run({ text: display, content });
          }
          return session.run(modelText);
        };
        return turn(run, { text: display, ...(meta.length ? { attachments: meta } : {}) });
      }),
    continueTurn: () => ready(() => turn(() => session.resume())),
    compact: () =>
      ready(() =>
        turn(async () => {
          emit({ type: "notice", text: "[ctx] summarizing the conversation so far…" });
          if (!(await session.compact())) emit({ type: "notice", text: "[ctx] nothing to compact yet" });
          return { sessionId: session.id, text: "", finishReason: "stop", steps: [] };
        }),
      ),
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
    listSessions: () =>
      ready(async () => toRows(await (await storageOf(runtime)).listSessions(), flags.cwd)),
    renameSession: (id, title) =>
      ready(async () => {
        const row = await (await storageOf(runtime)).getSession(id);
        if (!row) throw new Error(`no session "${id}"`);
        return setSessionTitle(flags.cwd, id, title);
      }),
    setSessionFlag: (id, flag, on) =>
      ready(async () => {
        const row = await (await storageOf(runtime)).getSession(id);
        if (!row) throw new Error(`no session "${id}"`);
        setSessionFlag(flags.cwd, id, flag, on);
      }),
    reload: () =>
      ready(async () => {
        idle();
        if (!flags.persist) throw new Error("restart tah to apply (persist is off)");
        await reload();
        changed.clear();
        reloadedAt = Date.now();
      }),
    async close() {
      stopWatching();
      await settled();
      rejectPending();
      await runtime.stop();
    },
  };
  return host;
}
