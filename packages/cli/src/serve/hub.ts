import type { ChatHost, HostEvent, SessionEvent } from "../host.js";

export class BusyError extends Error {
  constructor() {
    super("a turn is running — wait for it or stop it");
  }
}

export type Hub = {
  /** Replays the state so far (startup notices, session, last turn.end, this turn), then streams live. */
  subscribe(listener: (event: HostEvent) => void): () => void;
  /** Throws `BusyError` while a turn runs. */
  assertIdle(): void;
  /** Starts a turn (`send` / `continueTurn`) without waiting for it; throws `BusyError` while one runs. */
  start(run: () => Promise<void>): void;
};

/** One `ChatHost` shared by every browser tab; subscribe before `host.open()`. */
export function createHub(host: ChatHost): Hub {
  const listeners = new Set<(event: HostEvent) => void>();
  const startup: HostEvent[] = [];
  let base: SessionEvent | undefined;
  /** Kept so a new tab still sees the step-limit prompt and the status line. */
  let lastEnd: HostEvent | undefined;
  let turn: HostEvent[] = [];
  let busy = false;

  const record = (event: HostEvent) => {
    switch (event.type) {
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
      case "text": {
        const last = turn.at(-1);
        if (last?.type === "text") return void (turn[turn.length - 1] = { type: "text", delta: last.delta + event.delta });
        break;
      }
    }
    turn.push(event);
  };

  host.on((event) => {
    record(event);
    for (const listener of listeners) listener(event);
  });

  const assertIdle = () => {
    if (busy) throw new BusyError();
  };

  return {
    subscribe(listener) {
      for (const event of [...startup, ...(base ? [base] : []), ...(lastEnd ? [lastEnd] : []), ...turn]) {
        listener(event);
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
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
  };
}
