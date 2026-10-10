import type { HistoryItem, HostEvent } from "../host.js";
import { createMarkdownStream, type MarkdownStream } from "../markdown.js";

/** Finished output, printed once into the terminal's scrollback. */
export type Item =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string }
  | { id: number; kind: "tool"; tool: string; summary: string; ok: boolean; result: string }
  | { id: number; kind: "notice"; text: string }
  | { id: number; kind: "error"; text: string };

export type RunningTool = { callId: string; tool: string; summary: string };

export type Snapshot = {
  items: Item[];
  /** Streamed assistant text not yet complete enough to render as Markdown. */
  live: string;
  tools: RunningTool[];
  approval: { id: string; tool: string; input: unknown } | undefined;
  /** The last turn hit the step limit; Enter continues it. */
  stepLimit: boolean;
  busy: boolean;
  sessionId: string;
  rounds: number;
  model: string | undefined;
};

type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;
type ItemInput = WithoutId<Item>;

export class Transcript {
  snapshot: Snapshot = {
    items: [],
    live: "",
    tools: [],
    approval: undefined,
    stepLimit: false,
    busy: false,
    sessionId: "",
    rounds: 0,
    model: undefined,
  };
  private listeners = new Set<() => void>();
  private nextId = 0;
  private notifyPending = false;
  private md: MarkdownStream;

  constructor(private render: (markdown: string) => string) {
    this.md = this.stream();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private stream(): MarkdownStream {
    return createMarkdownStream((s) => {
      this.push({ kind: "assistant", text: s.replace(/\n$/, "") }, false);
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

  /** Writes out any streamed text, so what follows appears after it. */
  private settle(): void {
    this.md.flush();
    this.set({ live: "" });
  }

  user(text: string): void {
    this.push({ kind: "user", text });
    this.set({ busy: true, stepLimit: false });
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

  clearApproval(): void {
    this.set({ approval: undefined });
  }

  apply(event: HostEvent): void {
    switch (event.type) {
      case "session":
        this.settle();
        this.showSession(event.id, event.resumed, event.history, event.hiddenTurns);
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
        this.push({ kind: "tool", tool: event.tool, summary: event.summary, ok: event.ok, result: event.result });
        this.set({ tools: this.snapshot.tools.filter((t) => t.callId !== event.callId) });
        return;
      }
      case "approval":
        this.settle();
        this.set({ approval: { id: event.id, tool: event.tool, input: event.input } });
        return;
      case "notice":
        this.settle();
        this.push({ kind: "notice", text: event.text });
        return;
      case "turn.end":
        this.settle();
        this.set({
          busy: false,
          tools: [],
          approval: undefined,
          rounds: event.rounds,
          stepLimit: event.finishReason === "max_steps",
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
        this.set({ busy: false, tools: [], approval: undefined });
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
      if (h.role === "user") this.push({ kind: "user", text: h.text });
      else if (h.role === "assistant") this.push({ kind: "assistant", text: this.render(h.text) });
      else this.push({ kind: "tool", tool: h.tool, summary: h.summary, ok: h.ok, result: h.result });
    }
    this.md = this.stream();
    this.set({ sessionId: id, rounds: 0, stepLimit: false });
  }
}
