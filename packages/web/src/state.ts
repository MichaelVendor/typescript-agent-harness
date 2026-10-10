import type { HistoryItem, HostEvent } from "@typescript-agent-harness/cli";

export type Entry =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string }
  | { id: number; kind: "tool"; callId: string; tool: string; summary: string; status: "running" | "ok" | "failed"; result: string }
  | { id: number; kind: "notice"; text: string; error: boolean };

export type Approval = { id: string; tool: string; input: unknown };

export type State = {
  sessionId: string;
  entries: Entry[];
  approval: Approval | undefined;
  /** The last turn hit the step limit; the page offers to continue it. */
  stepLimit: boolean;
  busy: boolean;
  /** Counts finished turns: a turn can start and end within one rendered frame, so `busy` may never show it. */
  turnsEnded: number;
  rounds: number;
  model: string | undefined;
  nextId: number;
};

/** Things the page does itself: show a failed command, continue or drop a step-limited turn, start over on reconnect. */
export type LocalAction =
  | { type: "local.error"; text: string }
  | { type: "local.continue" }
  | { type: "local.dismiss" }
  | { type: "local.reset" };

export type Action = HostEvent | LocalAction | { type: "batch"; actions: Action[] };

export const initialState: State = {
  sessionId: "",
  entries: [],
  approval: undefined,
  stepLimit: false,
  busy: false,
  turnsEnded: 0,
  rounds: 0,
  model: undefined,
  nextId: 0,
};

type NewEntry = Entry extends infer E ? (E extends Entry ? Omit<E, "id"> : never) : never;

function push(state: State, ...items: NewEntry[]): State {
  let nextId = state.nextId;
  const added = items.map((item) => ({ ...item, id: nextId++ }) as Entry);
  return { ...state, entries: [...state.entries, ...added], nextId };
}

function fromHistory(h: HistoryItem): NewEntry {
  if (h.role === "tool") {
    return { kind: "tool", callId: h.callId, tool: h.tool, summary: h.summary, status: h.ok ? "ok" : "failed", result: h.result };
  }
  return { kind: h.role, text: h.text };
}

/** Any sign of a running turn: busy, and no pending step-limit prompt. */
const running = (state: State): State => ({ ...state, busy: true, stepLimit: false });

export function applyEvent(state: State, action: Action): State {
  switch (action.type) {
    case "batch":
      return action.actions.reduce(applyEvent, state);
    case "local.reset":
      return initialState;
    case "local.error":
      return push(state, { kind: "notice", text: action.text, error: true });
    case "local.continue":
      return running(state);
    case "local.dismiss":
      return { ...state, stepLimit: false };
    case "session": {
      // Notices before the first session are startup lines; a session switch starts a clean view.
      const kept = state.sessionId ? { ...state, entries: [] } : state;
      return push(
        { ...kept, sessionId: action.id, busy: false, approval: undefined, stepLimit: false, rounds: 0 },
        ...action.history.map(fromHistory),
      );
    }
    case "user":
      return push(running(state), { kind: "user", text: action.text });
    case "text": {
      const next = running(state);
      const last = next.entries.at(-1);
      if (last?.kind === "assistant") {
        return { ...next, entries: [...next.entries.slice(0, -1), { ...last, text: last.text + action.delta }] };
      }
      return push(next, { kind: "assistant", text: action.delta });
    }
    case "tool.start":
      return push(running(state), {
        kind: "tool",
        callId: action.callId,
        tool: action.tool,
        summary: action.summary,
        status: "running",
        result: "",
      });
    case "tool.end": {
      const status = action.ok ? "ok" : "failed";
      const index = state.entries.findIndex((e) => e.kind === "tool" && e.callId === action.callId);
      const entry = state.entries[index];
      if (entry?.kind !== "tool") {
        return push(state, { kind: "tool", callId: action.callId, tool: action.tool, summary: action.summary, status, result: action.result });
      }
      const entries = [...state.entries];
      entries[index] = { ...entry, status, result: action.result };
      return { ...state, entries };
    }
    case "approval":
      return { ...running(state), approval: { id: action.id, tool: action.tool, input: action.input } };
    case "approval.end":
      return state.approval?.id === action.id ? { ...state, approval: undefined } : state;
    case "notice":
      return push(state, { kind: "notice", text: action.text, error: action.error ?? false });
    case "turn.end":
      return {
        ...state,
        busy: false,
        turnsEnded: state.turnsEnded + 1,
        approval: undefined,
        rounds: action.rounds,
        stepLimit: action.finishReason === "max_steps",
        model: action.model ?? state.model,
      };
    case "turn.error":
      return push(
        { ...state, busy: false, approval: undefined, turnsEnded: state.turnsEnded + 1 },
        action.cancelled
          ? { kind: "notice", text: "turn cancelled — history kept", error: false }
          : { kind: "notice", text: `turn failed: ${action.message} — history kept; try again`, error: true },
      );
  }
}
