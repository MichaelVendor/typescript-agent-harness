import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { Todo } from "@typescript-agent-harness/tools";
import type { Question } from "../ask-user.js";
import type { HistoryItem, HostEvent, QueuedMessage } from "../host.js";
import type { AttachmentMeta } from "../attachments/store.js";
import { createMarkdownStream, type MarkdownStream } from "../markdown.js";
import { encodeImage, imagePaths, type ImageProtocol } from "./images.js";

/** Draws images under the text of an item; without one the transcript stays text-only. */
export type ImagePainter = {
  cwd: string;
  columns(): number;
  protocol: ImageProtocol;
  readFile(path: string): Buffer | undefined;
  attachmentPath(id: string): string | undefined;
};

const fileIo = {
  realpath: (p: string) => realpathSync(p),
  size: (p: string) => {
    try {
      return statSync(p).size;
    } catch {
      return Infinity;
    }
  },
  head: (p: string) => {
    try {
      const fd = openSync(p, "r");
      try {
        const buf = Buffer.alloc(16);
        return buf.subarray(0, readSync(fd, buf, 0, 16, 0));
      } finally {
        closeSync(fd);
      }
    } catch {
      return Buffer.alloc(0);
    }
  },
};

/** Finished output, printed once into the terminal's scrollback. */
export type Item =
  | { id: number; kind: "user"; text: string; images?: string }
  | { id: number; kind: "assistant"; text: string; images?: string; model?: string }
  | { id: number; kind: "tool"; tool: string; summary: string; ok: boolean; result: string; images?: string }
  | { id: number; kind: "todos"; todos: Todo[] }
  | { id: number; kind: "notice"; text: string }
  | { id: number; kind: "error"; text: string };

export type RunningTool = { callId: string; tool: string; summary: string };

export type Snapshot = {
  items: Item[];
  /** Streamed assistant text not yet complete enough to render as Markdown. */
  live: string;
  tools: RunningTool[];
  approval: { id: string; tool: string; input: unknown } | undefined;
  /** The model request is being retried (cleared by the next text, tool, card or turn end). */
  retry: string | undefined;
  /** An `ask_user` call waiting for the answers. */
  question: { id: string; questions: Question[] } | undefined;
  /** Messages sent during a turn, waiting for it to end. */
  queue: QueuedMessage[];
  /** The last turn hit the step limit; Enter continues it. */
  stepLimit: boolean;
  busy: boolean;
  sessionId: string;
  rounds: number;
  model: string | undefined;
  /** Tokens reported since this session was opened. */
  tokens: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
};

/** Events that mean the retried request got through (or the turn is over). */
const PROGRESS = new Set<HostEvent["type"]>(["session", "user", "text", "tool.start", "approval", "question", "turn.end", "turn.error"]);

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type ItemInput = WithoutId<Item>;

export class Transcript {
  snapshot: Snapshot = {
    items: [],
    live: "",
    tools: [],
    approval: undefined,
    question: undefined,
    queue: [],
    retry: undefined,
    stepLimit: false,
    busy: false,
    sessionId: "",
    rounds: 0,
    model: undefined,
    tokens: undefined,
  };
  private listeners = new Set<() => void>();
  private nextId = 0;
  private notifyPending = false;
  private md: MarkdownStream;

  constructor(
    private render: (markdown: string) => string,
    private painter?: ImagePainter,
  ) {
    this.md = this.stream();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private stream(): MarkdownStream {
    return createMarkdownStream((s) => {
      const model = this.snapshot.model;
      this.push(
        { kind: "assistant", text: s.replace(/\n$/, ""), ...(model ? { model } : {}), ...this.images(this.textImages(s)) },
        false,
      );
    }, this.render);
  }

  /**
   * Listeners hear about changes at most once per macrotask: deltas can arrive in back-to-back
   * microtasks, and a sync re-render per delta trips React's nested-update limit (Ink's useBoxMetrics
   * answers each render with another update).
   */
  private set(patch: Partial<Snapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    if (this.notifyPending) return;
    this.notifyPending = true;
    setImmediate(() => {
      this.notifyPending = false;
      for (const listener of this.listeners) listener();
    });
  }

  private push(item: ItemInput, notify = true): void {
    const items = [...this.snapshot.items, { ...item, id: this.nextId++ } as Item];
    if (notify) this.set({ items });
    else this.snapshot = { ...this.snapshot, items };
  }

  private images(paths: string[]): { images?: string } {
    const painter = this.painter;
    if (!painter) return {};
    const out: string[] = [];
    for (const p of paths) {
      try {
        const bytes = painter.readFile(p);
        if (!bytes) continue;
        const seq = encodeImage({
          protocol: painter.protocol,
          bytes,
          columns: painter.columns(),
          label: path.basename(p),
        });
        if (seq) out.push(seq);
      } catch {
        // this one image is skipped
      }
    }
    return out.length ? { images: out.join("\n") } : {};
  }

  private toolImages(event: { result: string; path?: string; imageText?: string }): string[] {
    const parts = [event.result];
    if (event.path) parts.push(event.path);
    if (event.imageText) parts.push(event.imageText);
    return this.textImages(parts.join("\n"));
  }

  private textImages(text: string): string[] {
    if (!this.painter) return [];
    try {
      return imagePaths(text, this.painter.cwd, fileIo);
    } catch {
      return [];
    }
  }

  private attachmentImages(attachments: AttachmentMeta[] | undefined): string[] {
    const painter = this.painter;
    if (!painter) return [];
    const paths: string[] = [];
    for (const a of attachments ?? []) {
      const svg = a.mime === "image/svg+xml" || /\.svg$/i.test(a.name);
      if (a.kind !== "image" && !svg) continue;
      try {
        const p = painter.attachmentPath(a.id);
        if (p) paths.push(p);
      } catch {
        // skipped
      }
    }
    return paths;
  }

  /** Blocks closed before `turn.end` were written without this turn's model. */
  private tagTurnModel(model: string): void {
    let from = 0;
    for (let i = this.snapshot.items.length - 1; i >= 0; i--) {
      if (this.snapshot.items[i]?.kind === "user") {
        from = i + 1;
        break;
      }
    }
    const items = this.snapshot.items.map((item, i) =>
      i >= from && item.kind === "assistant" && item.model !== model ? { ...item, model } : item,
    );
    this.snapshot = { ...this.snapshot, items };
  }

  /** Writes out any streamed text, so what follows appears after it. */
  private settle(): void {
    this.md.flush();
    this.set({ live: "" });
  }

  note(text: string, kind: "notice" | "error" = "notice"): void {
    this.push({ kind, text });
  }

  continueTurn(): void {
    this.set({ busy: true, stepLimit: false });
  }

  dismissStepLimit(): void {
    this.set({ stepLimit: false });
  }

  apply(event: HostEvent): void {
    if (this.snapshot.retry !== undefined && PROGRESS.has(event.type)) this.set({ retry: undefined });
    switch (event.type) {
      case "session":
        this.settle();
        this.showSession(event.id, event.resumed, event.history, event.hiddenTurns);
        if (event.todos?.some((t) => t.status !== "completed")) this.push({ kind: "todos", todos: event.todos });
        return;
      case "user":
        this.settle();
        this.push({ kind: "user", text: event.text, ...this.images(this.attachmentImages(event.attachments)) });
        this.set({ busy: true, stepLimit: false });
        return;
      case "text":
        this.md.push(event.delta);
        this.set({ live: this.md.pending() });
        return;
      case "tool.start":
        this.settle();
        this.set({ tools: [...this.snapshot.tools, { callId: event.callId, tool: event.tool, summary: event.summary }] });
        return;
      case "tool.end": {
        this.settle();
        this.push({
          kind: "tool",
          tool: event.tool,
          summary: event.summary,
          ok: event.ok,
          result: event.result,
          ...this.images(this.toolImages(event)),
        });
        this.set({ tools: this.snapshot.tools.filter((t) => t.callId !== event.callId) });
        return;
      }
      case "todos":
        this.push({ kind: "todos", todos: event.todos });
        return;
      case "approval":
        this.settle();
        this.set({ approval: { id: event.id, tool: event.tool, input: event.input } });
        return;
      case "approval.end":
        if (this.snapshot.approval?.id === event.id) this.set({ approval: undefined });
        return;
      case "question":
        this.settle();
        this.set({ question: { id: event.id, questions: event.questions } });
        return;
      case "question.end":
        if (this.snapshot.question?.id === event.id) this.set({ question: undefined });
        return;
      case "retry":
        this.set({ retry: event.text });
        return;
      case "queue":
        this.set({ queue: event.items });
        return;
      case "notice":
        this.settle();
        this.push({ kind: event.error ? "error" : "notice", text: event.text });
        return;
      case "turn.end":
        if (event.model) this.snapshot = { ...this.snapshot, model: event.model };
        this.settle();
        if (event.model) this.tagTurnModel(event.model);
        this.set({
          busy: false,
          tools: [],
          approval: undefined,
          question: undefined,
          rounds: event.rounds,
          stepLimit: event.finishReason === "max_steps",
          tokens: event.sessionUsage ?? this.snapshot.tokens,
          ...(event.model ? { model: event.model } : {}),
        });
        return;
      case "turn.error":
        this.settle();
        this.push(
          event.cancelled
            ? { kind: "notice", text: "[tah] turn cancelled — history kept; keep chatting or /exit" }
            : { kind: "error", text: `[tah] turn failed: ${event.message} — history kept; try again` },
        );
        this.set({
          busy: false,
          tools: [],
          approval: undefined,
          question: undefined,
          tokens: event.sessionUsage ?? this.snapshot.tokens,
        });
        return;
    }
  }

  private showSession(id: string, resumed: boolean, history: HistoryItem[], hidden: number): void {
    const turns = history.filter((h) => h.role === "user").length;
    const header = !resumed
      ? `[tah] new session ${id}`
      : hidden > 0
        ? `[tah] session ${id} · resumed · showing last ${turns} of ${turns + hidden} turns`
        : `[tah] session ${id} · resumed`;
    this.push({ kind: "notice", text: header });
    for (const h of history) {
      if (h.role === "user") this.push({ kind: "user", text: h.text, ...this.images(this.attachmentImages(h.attachments)) });
      else if (h.role === "assistant") {
        this.push({ kind: "assistant", text: this.render(h.text), ...this.images(this.textImages(h.text)) });
      } else {
        this.push({
          kind: "tool",
          tool: h.tool,
          summary: h.summary,
          ok: h.ok,
          result: h.result,
          ...this.images(this.toolImages(h)),
        });
      }
    }
    this.md = this.stream();
    this.set({ sessionId: id, rounds: 0, stepLimit: false, tokens: undefined });
  }
}
