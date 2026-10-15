import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChatHost, HostEvent, SessionEvent } from "../dist/host.js";
import { createHub } from "../dist/serve/hub.js";

function stubHost(id: string) {
  const listeners = new Set<(e: HostEvent) => void>();
  const snap: SessionEvent = { type: "session", id, resumed: false, history: [], hiddenTurns: 0 };
  const host = {
    on(l: (e: HostEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    snapshot: () => snap,
  } as unknown as ChatHost;
  return { host, snap, emit: (e: HostEvent) => listeners.forEach((l) => l(e)), count: () => listeners.size };
}

test("swap replays only the new host (session before its startup notices) and stops listening to the old one", () => {
  const a = stubHost("a");
  const b = stubHost("b");
  const hub = createHub(a.host);
  a.emit({ type: "notice", text: "boot a" });
  a.emit(a.snap);

  const live: HostEvent[] = [];
  hub.subscribe((e) => live.push(e));
  live.length = 0;

  hub.swap(b.host, [{ type: "notice", text: "boot b" }, b.snap]);
  assert.deepEqual(live, [b.snap, { type: "notice", text: "boot b" }]);
  assert.equal(a.count(), 0);

  a.emit({ type: "text", delta: "stale" });
  b.emit({ type: "text", delta: "fresh" });
  assert.deepEqual(live.at(-1), { type: "text", delta: "fresh" });

  const late: HostEvent[] = [];
  hub.subscribe((e) => late.push(e));
  assert.deepEqual(late, [{ type: "notice", text: "boot b" }, b.snap, { type: "text", delta: "fresh" }]);
});

test("the latest queue replays after the turn; a queued turn the host starts makes the hub busy; swap empties the queue", () => {
  const a = stubHost("a");
  const hub = createHub(a.host);
  a.emit(a.snap);
  const queue: HostEvent = { type: "queue", items: [{ id: "queued_1", text: "next", held: false }] };
  a.emit({ type: "user", text: "hi" });
  a.emit(queue);
  a.emit({ type: "text", delta: "Hello" });
  const late: HostEvent[] = [];
  hub.subscribe((e) => late.push(e));
  assert.deepEqual(late.slice(1), [{ type: "user", text: "hi" }, { type: "text", delta: "Hello" }, queue]);

  a.emit({ type: "turn.end", state: "idle", finishReason: "stop", rounds: 1 });
  assert.equal(hub.busy, false);
  a.emit({ type: "queue", items: [] });
  a.emit({ type: "user", text: "next" });
  assert.equal(hub.busy, true);
  a.emit({ type: "turn.end", state: "idle", finishReason: "stop", rounds: 1 });

  a.emit(queue);
  late.length = 0;
  hub.swap(stubHost("b").host, []);
  assert.deepEqual(late, [{ type: "queue", items: [] }]);
});

test("swap is refused while a turn runs", () => {
  const a = stubHost("a");
  const hub = createHub(a.host);
  a.emit(a.snap);
  hub.start(() => new Promise(() => {}));
  assert.throws(() => hub.swap(stubHost("b").host, []), /a turn is running/);
});
