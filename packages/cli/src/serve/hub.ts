import type { ChatHost, HostEvent, SessionEvent } from "../host.js";

export class BusyError extends Error {
  constructor() {
    super("a turn is running — wait for it or stop it");
  }
}

export type Hub = {
  /** Replays the state so far (startup notices, session, last turn.end, this turn), then streams live. */
  subscribe(listener: (event: HostEvent) => void): () => void;
  readonly busy: boolean;
  /** Throws `BusyError` while a turn runs. */
  assertIdle(): void;
  /** Starts a turn (`send` / `continueTurn`) without waiting for it; throws `BusyError` while one runs. */
  start(run: () => Promise<void>): void;
  /** Moves every tab to `host`; `buffered` are the events it emitted while opening. Throws `BusyError` while a turn runs. */
  swap(host: ChatHost, buffered: HostEvent[]): void;
};

/** One `ChatHost` shared by every browser tab; subscribe before `host.open()`. */
export function createHub(first: ChatHost): Hub {
  let host = first;
  const listeners = new Set<(event: HostEvent) => void>();
  const startup: HostEvent[] = [];
  let base: SessionEvent | undefined;
  /** Kept so a new tab still sees the step-limit prompt and the status line. */
  let lastEnd: HostEvent | undefined;
  let turn: HostEvent[] = [];
  let queue: HostEvent | undefined;
  let busy = false;

  const record = (event: HostEvent) => {
    switch (event.type) {
      case "queue":
        queue = event;
        return;
      case "user":
        // A queued message starts its turn from inside the host, without `start`.
        busy = true;
        break;
      case "session":
        base = event;
        lastEnd = undefined;
        turn = [];
        return;
      case "turn.end":
      case "turn.error":
        busy = false;
        base = host.snapshot();
        lastEnd = event.type === "turn.end" ? event : undefined;
        turn = [];
        return;
      case "notice":
        if (!base) return void startup.push(event);
        break;
      case "approval.end":
        turn = turn.filter((e) => !(e.type === "approval" && e.id === event.id));
        return;
      case "question.end":
        turn = turn.filter((e) => !(e.type === "question" && e.id === event.id));
        return;
      case "text": {
        const last = turn.at(-1);
        if (last?.type === "text") return void (turn[turn.length - 1] = { type: "text", delta: last.delta + event.delta });
        break;
      }
    }
    turn.push(event);
  };

  const forward = (event: HostEvent) => {
    record(event);
    for (const listener of listeners) listener(event);
  };
  let unsubscribe = host.on(forward);

  const assertIdle = () => {
    if (busy) throw new BusyError();
  };

  return {
    subscribe(listener) {
      for (const event of [...startup, ...(base ? [base] : []), ...(lastEnd ? [lastEnd] : []), ...turn, ...(queue ? [queue] : [])]) {
        listener(event);
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get busy() {
      return busy;
    },
    assertIdle,
    start(run) {
      assertIdle();
      busy = true;
      lastEnd = undefined;
      run().catch(() => {
        busy = false;
      });
    },
    swap(next, buffered) {
      assertIdle();
      unsubscribe();
      startup.length = 0;
      base = undefined;
      lastEnd = undefined;
      turn = [];
      // The queue stays with the old host.
      if (queue) forward({ type: "queue", items: [] });
      queue = undefined;
      host = next;
      // Open tabs clear their view on `session`, so the new folder's startup notices go after it.
      const notices = buffered.filter((event) => event.type === "notice");
      for (const event of buffered) if (event.type !== "notice") forward(event);
      startup.push(...notices);
      for (const event of notices) for (const listener of listeners) listener(event);
      unsubscribe = host.on(forward);
    },
  };
}
