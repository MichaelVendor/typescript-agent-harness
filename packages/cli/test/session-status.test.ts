import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionStatus } from "../src/serve/session-status.ts";

test("buildSessionStatus main-only", () => {
  const s = buildSessionStatus({
    cwd: "/tmp/proj",
    busy: true,
    pending: { kind: "approval", id: "a1" },
  });
  assert.equal(s.cwd, "/tmp/proj");
  assert.equal(s.busy, true);
  assert.equal(s.pending?.id, "a1");
  assert.deepEqual(s.workers, []);
});

test("buildSessionStatus workers and ticketCount", () => {
  const s = buildSessionStatus({
    cwd: "/tmp/main",
    busy: false,
    pending: null,
    workers: [
      { workerId: "main", busy: false },
      { workerId: "w1", busy: true, attention: "approval" },
    ],
    ticketCount: 3,
  });
  assert.equal(s.workers.length, 2);
  assert.equal(s.workers[1]?.attention, "approval");
  assert.deepEqual(s.superAgent, { ticketCount: 3 });
});
