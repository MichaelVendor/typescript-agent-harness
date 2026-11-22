import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import type { ChatHost, HostEvent } from "../dist/host.js";
import { createOrchestrator } from "../dist/serve/orchestrator.js";

function fakeMain(sessionId = "main-session") {
  const listeners = new Set<(e: HostEvent) => void>();
  const snap = { type: "session" as const, id: sessionId, resumed: false, history: [], hiddenTurns: 0 };
  const host = {
    sessionId,
    snapshot: () => snap,
    on(l: (e: HostEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async send() {},
    cancel() {},
  } as unknown as ChatHost;
  return host;
}

test("snapshot includes main and default focusId", async () => {
  const mainCwd = "/tmp/main-cwd";
  const orch = createOrchestrator({
    main: fakeMain(),
    mainCwd,
    flags: parseArgv(["--mock"]),
    homeDir: "/tmp/home",
    spawnWorker: async () => ({ url: "http://127.0.0.1:1", kill() {} }),
  });
  const snap = orch.snapshot();
  assert.equal(snap.focusId, "main");
  assert.equal(snap.workers.length, 1);
  assert.equal(snap.workers[0]?.workerId, "main");
  assert.equal(snap.workers[0]?.cwd, mainCwd);
  assert.equal(snap.workers[0]?.busy, false);
  await orch.dispose();
});