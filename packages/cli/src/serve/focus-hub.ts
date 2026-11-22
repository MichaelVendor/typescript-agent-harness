import type { HostEvent, SessionEvent } from "../host.js";
import type { Hub } from "./hub.js";
import type { Orchestrator } from "./orchestrator.js";
import type { ServeEvent } from "./protocol.js";

export type FocusHub = {
  subscribe(listener: (event: ServeEvent) => void): () => void;
  /** After orchestrator.focus — emit workers list and replay the new focus buffer. */
  notifyFocusChanged(): void;
  /** After list membership changes (parallel/stop/remove/restart). */
  notifyWorkersChanged(): void;
  dispose(): void;
};

type Buffer = {
  events: HostEvent[];
  session?: HostEvent | undefined;
  lastEnd?: HostEvent | undefined;
  turn: HostEvent[];
  queue?: HostEvent | undefined;
  startup: HostEvent[];
};

function emptyBuf(): Buffer {
  return { events: [], turn: [], startup: [] };
}

function record(buf: Buffer, event: HostEvent): void {
  switch (event.type) {
    case "queue":
      buf.queue = event;
      return;
    case "session":
      buf.session = event;
      delete buf.lastEnd;
      buf.turn = [];
      return;
    case "turn.end":
    case "turn.error":
      if (event.type === "turn.end") buf.lastEnd = event;
      else delete buf.lastEnd;
      buf.turn = [];
      return;
    case "notice":
      if (!buf.session) {
        buf.startup.push(event);
        return;
      }
      break;
    case "approval.end":
      buf.turn = buf.turn.filter((e) => !(e.type === "approval" && e.id === event.id));
      return;
    case "question.end":
      buf.turn = buf.turn.filter((e) => !(e.type === "question" && e.id === event.id));
      return;
    case "text": {
      const last = buf.turn.at(-1);
      if (last?.type === "text") {
        buf.turn[buf.turn.length - 1] = { type: "text", delta: last.delta + event.delta };
        return;
      }
      break;
    }
  }
  buf.turn.push(event);
}

function snapshot(buf: Buffer): HostEvent[] {
  return [
    ...buf.startup,
    ...(buf.session ? [buf.session] : []),
    ...(buf.lastEnd ? [buf.lastEnd] : []),
    ...buf.turn,
    ...(buf.queue ? [buf.queue] : []),
  ];
}

function tag(orch: Orchestrator, workerId: string, event: HostEvent): ServeEvent {
  const w = orch.list().find((x) => x.id === workerId);
  return {
    ...event,
    workerId,
    cwd: w?.cwd ?? "",
    sessionId: w?.sessionId ?? (event.type === "session" ? event.id : ""),
  };
}

function workersEvent(orch: Orchestrator): ServeEvent {
  return { type: "workers", workers: orch.list(), focusId: orch.focusId };
}

function attentionSummary(event: HostEvent & { type: "approval" | "question" }): string {
  if (event.type === "approval") return `approval: ${event.tool}`;
  return `question: ${event.questions.map((q) => q.question).join("; ") || event.id}`;
}

/**
 * Parent SSE hub: full stream for focus only; attention + workers for the rest.
 * Main transcript follows `mainHub` (survives workspace host swap); child workers use orchestrator events.
 */
export function createFocusHub(
  orch: Orchestrator,
  mainHub: Hub,
  /** Main host snapshot — hub refreshes this on turn.end without re-emitting `session`. */
  mainSnapshot?: () => SessionEvent,
): FocusHub {
  const listeners = new Set<(event: ServeEvent) => void>();
  const buffers = new Map<string, Buffer>();
  const bufOf = (id: string) => {
    let b = buffers.get(id);
    if (!b) {
      b = emptyBuf();
      buffers.set(id, b);
    }
    return b;
  };

  const emit = (event: ServeEvent) => {
    for (const l of listeners) l(event);
  };

  const replayFocus = () => {
    const id = orch.focusId;
    for (const event of snapshot(bufOf(id))) emit(tag(orch, id, event));
  };

  const onBackground = (workerId: string, event: HostEvent) => {
    if (event.type === "approval" || event.type === "question") {
      emit({
        type: "attention",
        workerId,
        kind: event.type,
        summary: attentionSummary(event),
      });
      emit(workersEvent(orch));
      return;
    }
    if (event.type === "user" || event.type === "turn.end" || event.type === "turn.error" || event.type === "session") {
      emit(workersEvent(orch));
    }
  };

  const unsubMain = mainHub.subscribe((event) => {
    record(bufOf("main"), event);
    if ((event.type === "turn.end" || event.type === "session") && mainSnapshot) {
      bufOf("main").session = mainSnapshot();
    }
    if (orch.focusId === "main") emit(tag(orch, "main", event));
    else onBackground("main", event);
  });

  const unsubOrch = orch.onEvent((workerId, event) => {
    if (workerId === "main") return; // mainHub owns main transcript (and host swaps)
    record(bufOf(workerId), event);
    if (workerId === orch.focusId) emit(tag(orch, workerId, event));
    else onBackground(workerId, event);
  });

  return {
    subscribe(listener) {
      listener(workersEvent(orch));
      for (const event of snapshot(bufOf(orch.focusId))) listener(tag(orch, orch.focusId, event));
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notifyFocusChanged() {
      emit(workersEvent(orch));
      replayFocus();
    },
    notifyWorkersChanged() {
      emit(workersEvent(orch));
    },
    dispose() {
      unsubMain();
      unsubOrch();
      listeners.clear();
      buffers.clear();
    },
  };
}
