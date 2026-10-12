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

test("swap replays only the new host and stops listening to the old one", () => {
  const a = stubHost("a");
  const b = stubHost("b");
  const hub = createHub(a.host);
  a.emit({ type: "notice", text: "boot a" });
  a.emit(a.snap);

  const live: HostEvent[] = [];
  hub.subscribe((e) => live.push(e));
  live.length = 0;

  hub.swap(b.host, [{ type: "notice", text: "boot b" }, b.snap]);
  assert.deepEqual(live, [{ type: "notice", text: "boot b" }, b.snap]);
  assert.equal(a.count(), 0);

  a.emit({ type: "text", delta: "stale" });
  b.emit({ type: "text", delta: "fresh" });
  assert.deepEqual(live.at(-1), { type: "text", delta: "fresh" });

  const late: HostEvent[] = [];
  hub.subscribe((e) => late.push(e));
  assert.deepEqual(late, [{ type: "notice", text: "boot b" }, b.snap, { type: "text", delta: "fresh" }]);
});

test("swap is refused while a turn runs", () => {
  const a = stubHost("a");
  const hub = createHub(a.host);
  a.emit(a.snap);
  hub.start(() => new Promise(() => {}));
  assert.throws(() => hub.swap(stubHost("b").host, []), /a turn is running/);
});
