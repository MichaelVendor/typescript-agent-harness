import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import type { ChatHost, HostEvent } from "../dist/host.js";
import { createOrchestrator, type Orchestrator } from "../dist/serve/orchestrator.js";
import { loadWorkspaceEntries } from "../dist/workspaces.js";

type FakeWorker = {
  cwd: string;
  token: string;
  calls: { route: string; body: Record<string, unknown>; auth: string | undefined }[];
  killed: boolean;
  emit(event: HostEvent): void;
  crash(): void;
};

function fakeMain(sessionId = "main-session") {
  const listeners = new Set<(e: HostEvent) => void>();
  const sent: string[] = [];
  const snap = { type: "session" as const, id: sessionId, resumed: false, history: [], hiddenTurns: 0 };
  const host = {
    sessionId,
    snapshot: () => snap,
    on(l: (e: HostEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async send(text: string) {
      sent.push(text);
    },
    cancel() {},
  } as unknown as ChatHost;
  return { host, sent, emit: (e: HostEvent) => listeners.forEach((l) => l(e)), snap };
}

function harness(extra: { maxBusy?: number; mainCwd?: string; homeDir?: string } = {}) {
  const main = fakeMain();
  const workers: FakeWorker[] = [];
  const servers: Server[] = [];
  const spawnWorker = async ({ cwd, token }: { id: string; cwd: string; token: string }) => {
    const sse = new Set<ServerResponse>();
    const w: FakeWorker = {
      cwd,
      token,
      calls: [],
      killed: false,
      emit(event) {
        for (const res of sse) res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      crash() {
        for (const res of sse) res.destroy();
      },
    };
    const server = createServer((req, res) => {
      const route = new URL(req.url ?? "/", "http://x").pathname;
      if (route === "/events") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("retry: 1000\n\n");
        sse.add(res);
        req.on("close", () => sse.delete(res));
        return;
      }
      if (route === "/session") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            type: "session",
            id: `sess-${cwd}`,
            resumed: false,
            history: [],
            hiddenTurns: 0,
          }),
        );
        return;
      }
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        w.calls.push({ route, body: raw ? JSON.parse(raw) : {}, auth: req.headers.authorization });
        res.writeHead(202).end();
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    workers.push(w);
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      kill() {
        w.killed = true;
        for (const res of sse) res.end();
        server.closeAllConnections();
        server.close();
      },
    };
  };
  const orch: Orchestrator = createOrchestrator({
    main: main.host,
    mainCwd: extra.mainCwd ?? "/tmp/main-cwd",
    flags: parseArgv(["--mock"]),
    homeDir: extra.homeDir ?? "/tmp/home",
    spawnWorker,
    ...(extra.maxBusy ? { maxBusy: extra.maxBusy } : {}),
  });
  return {
    main,
    orch,
    workers,
    async close() {
      await orch.dispose();
      for (const s of servers) s.closeAllConnections();
    },
  };
}

async function until(pred: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

test("starts with only main, focused", async () => {
  const h = harness();
  try {
    assert.equal(h.orch.focusId, "main");
    const list = h.orch.list();
    assert.equal(list.length, 1);
    assert.equal(list[0]?.id, "main");
    assert.equal(list[0]?.cwd, "/tmp/main-cwd");
    assert.equal(list[0]?.sessionId, "main-session");
    assert.equal(h.orch.busyCount(), 0);
  } finally {
    await h.close();
  }
});

test("two workers both forward events; focus switches and clears attention", async () => {
  const h = harness();
  try {
    const a = await h.orch.parallel({ cwd: "/tmp/wa" });
    const b = await h.orch.parallel({ cwd: "/tmp/wb" });
    assert.notEqual(a.id, "main");
    assert.notEqual(a.id, b.id);
    assert.equal(h.workers.length, 2);
    assert.ok(h.workers[0]?.token && h.workers[0].token !== h.workers[1]?.token);

    const seen: [string, HostEvent][] = [];
    h.orch.onEvent((id, e) => seen.push([id, e]));
    await new Promise((r) => setTimeout(r, 100)); // let SSE subscriptions attach

    h.workers[0]?.emit({ type: "text", delta: "from-a" });
    h.workers[1]?.emit({ type: "text", delta: "from-b" });
    await until(() => seen.length >= 2);
    assert.ok(seen.some(([id, e]) => id === a.id && e.type === "text" && e.delta === "from-a"));
    assert.ok(seen.some(([id, e]) => id === b.id && e.type === "text" && e.delta === "from-b"));

    h.main.emit({ type: "text", delta: "from-main" });
    assert.ok(seen.some(([id, e]) => id === "main" && e.type === "text" && e.delta === "from-main"));

    // approval on unfocused worker raises attention
    h.workers[0]?.emit({ type: "approval", id: "ap1", tool: "bash", input: {} });
    await until(() => h.orch.list().find((w) => w.id === a.id)?.needsAttention === true);

    h.orch.focus(a.id);
    assert.equal(h.orch.focusId, a.id);
    assert.equal(h.orch.list().find((w) => w.id === a.id)?.needsAttention, false);
    assert.throws(() => h.orch.focus("nope"), /unknown worker/);
  } finally {
    await h.close();
  }
});

test("parallel sets sessionId from GET /session without session SSE", async () => {
  const h = harness();
  try {
    const a = await h.orch.parallel({ cwd: "/tmp/wa" });
    assert.equal(a.sessionId, "sess-/tmp/wa");
    assert.equal(h.orch.list().find((w) => w.id === a.id)?.sessionId, "sess-/tmp/wa");
  } finally {
    await h.close();
  }
});

test("worker sessionId follows session event; busy follows user/turn.end", async () => {
  const h = harness();
  try {
    const a = await h.orch.parallel({ cwd: "/tmp/wa" });
    await new Promise((r) => setTimeout(r, 100));
    h.workers[0]?.emit({ type: "session", id: "sess-1", resumed: false, history: [], hiddenTurns: 0 });
    await until(() => h.orch.list().find((w) => w.id === a.id)?.sessionId === "sess-1");
    h.workers[0]?.emit({ type: "user", text: "hi" });
    await until(() => h.orch.list().find((w) => w.id === a.id)?.busy === true);
    assert.equal(h.orch.busyCount(), 1);
    h.workers[0]?.emit({ type: "turn.end", state: "done", finishReason: "stop", rounds: 1 });
    await until(() => h.orch.busyCount() === 0);
  } finally {
    await h.close();
  }
});

test("send proxies to worker with bearer and to main host", async () => {
  const h = harness();
  try {
    const a = await h.orch.parallel({ cwd: "/tmp/wa" });
    await assert.rejects(h.orch.send(a.id, "hello", ["att1"]), /attachments are only supported on the main worker/);
    await h.orch.send(a.id, "hello");
    const call = h.workers[0]?.calls.find((c) => c.route === "/send");
    assert.deepEqual(call?.body, { text: "hello", attachmentIds: [] });
    assert.equal(call?.auth, `Bearer ${h.workers[0]?.token}`);

    await h.orch.send("main", "to-main");
    assert.deepEqual(h.main.sent, ["to-main"]);
    await assert.rejects(h.orch.send("nope", "x"), /unknown worker/);

    await h.orch.cancel(a.id);
    await h.orch.compact(a.id);
    await h.orch.continueTurn(a.id);
    await h.orch.answer(a.id, "ap1", "yes");
    await h.orch.queue(a.id, { id: "q1", remove: true });
    const routes = h.workers[0]?.calls.map((c) => c.route);
    for (const r of ["/cancel", "/compact", "/continue", "/answer", "/queue"]) assert.ok(routes?.includes(r), r);
  } finally {
    await h.close();
  }
});

test("cap: 5th busy rejects with 409 message (main counts)", async () => {
  const h = harness();
  try {
    h.main.emit({ type: "user", text: "busy main" });
    assert.equal(h.orch.busyCount(), 1);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await h.orch.parallel({ cwd: `/tmp/w${i}` })).id);
    await new Promise((r) => setTimeout(r, 100));
    for (const id of ids) await h.orch.send(id, "go");
    assert.equal(h.orch.busyCount(), 4);

    await assert.rejects(h.orch.parallel({ cwd: "/tmp/w-extra" }), { message: "too many busy workers (max 4)" });
    h.main.emit({ type: "turn.end", state: "done", finishReason: "stop", rounds: 1 });
    assert.equal(h.orch.busyCount(), 3);
    const fifth = await h.orch.parallel({ cwd: "/tmp/w-extra" });
    await h.orch.send(fifth.id, "go");
    assert.equal(h.orch.busyCount(), 4);

    // idle->busy on main is rejected at cap; queueing onto a busy target is allowed
    await assert.rejects(h.orch.send("main", "x"), /too many busy workers \(max 4\)/);
    await h.orch.send(fifth.id, "queued");
  } finally {
    await h.close();
  }
});

test("maxBusy option overrides default", async () => {
  const h = harness({ maxBusy: 1 });
  try {
    h.main.emit({ type: "user", text: "x" });
    await assert.rejects(h.orch.parallel({ cwd: "/tmp/w" }), { message: "too many busy workers (max 1)" });
  } finally {
    await h.close();
  }
});

test("stop / restart / remove manage worker lifecycle", async () => {
  const h = harness();
  try {
    const a = await h.orch.parallel({ cwd: "/tmp/wa" });
    await h.orch.stop(a.id);
    assert.equal(h.workers[0]?.killed, true);
    assert.equal(h.orch.list().find((w) => w.id === a.id)?.dead, true);

    await h.orch.restart(a.id);
    assert.equal(h.workers.length, 2);
    assert.equal(h.workers[1]?.cwd, "/tmp/wa");
    assert.notEqual(h.workers[1]?.token, h.workers[0]?.token);
    assert.equal(h.orch.list().find((w) => w.id === a.id)?.dead, undefined);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(h.orch.list().find((w) => w.id === a.id)?.dead, undefined);

    h.orch.focus(a.id);
    await h.orch.remove(a.id);
    assert.equal(h.workers[1]?.killed, true);
    assert.equal(h.orch.list().some((w) => w.id === a.id), false);
    assert.equal(h.orch.focusId, "main");
    await assert.rejects(h.orch.stop("main"), /main/);
    await assert.rejects(h.orch.remove("main"), /main/);
  } finally {
    await h.close();
  }
});

test("worker whose event stream ends is marked dead and not busy", async () => {
  const h = harness();
  try {
    const a = await h.orch.parallel({ cwd: "/tmp/wa" });
    await new Promise((r) => setTimeout(r, 100));
    h.workers[0]?.emit({ type: "user", text: "x" });
    await until(() => h.orch.busyCount() === 1);
    h.workers[0]?.crash();
    await until(() => h.orch.list().find((w) => w.id === a.id)?.dead === true);
    assert.equal(h.orch.busyCount(), 0);
  } finally {
    await h.close();
  }
});

test("parallel with name creates a git worktree; remove cleans it up", async () => {
  const repo = await realpath(await mkdtemp(path.join(tmpdir(), "tah-orch-repo-")));
  const home = await mkdtemp(path.join(tmpdir(), "tah-orch-home-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "--allow-empty", "-m", "init");
  const h = harness({ mainCwd: repo, homeDir: home });
  const orch = h.orch;
  try {
    const w = await orch.parallel({ name: "feat-x" });
    assert.equal(w.cwd, path.join(repo, ".tah", "worktrees", "feat-x"));
    assert.deepEqual(w.worktree, { name: "feat-x", parent: repo });
    assert.deepEqual(loadWorkspaceEntries(home), [{ path: w.cwd, kind: "worktree", parent: repo }]);
    assert.deepEqual(h.workers.map((x) => x.cwd), [w.cwd]);
    assert.match(execFileSync("git", ["branch", "--list", "tah/feat-x"], { cwd: repo }).toString(), /tah\/feat-x/);

    await assert.rejects(orch.parallel({ name: "bad name" }), /invalid worktree name/);

    await orch.remove(w.id);
    assert.equal(execFileSync("git", ["branch", "--list", "tah/feat-x"], { cwd: repo }).toString().trim(), "");
  } finally {
    await h.close();
  }
});

test("dispose kills every worker", async () => {
  const h = harness();
  await h.orch.parallel({ cwd: "/tmp/wa" });
  await h.orch.parallel({ cwd: "/tmp/wb" });
  await h.close();
  assert.ok(h.workers.every((w) => w.killed));
});

test("setMain rebinds cwd, session, busy, and event source after workspace swap", async () => {
  const h = harness({ mainCwd: "/tmp/cwd-a" });
  try {
    h.main.emit({ type: "user", text: "busy" });
    assert.equal(h.orch.busyCount(), 1);

    const next = fakeMain("sess-b");
    next.snap.id = "sess-b";
    h.orch.setMain(next.host, "/tmp/cwd-b");
    const main = h.orch.list().find((w) => w.id === "main");
    assert.equal(main?.cwd, "/tmp/cwd-b");
    assert.equal(main?.sessionId, "sess-b");
    assert.equal(main?.busy, false);
    assert.equal(h.orch.busyCount(), 0);

    h.main.emit({ type: "user", text: "stale" });
    assert.equal(h.orch.busyCount(), 0);

    next.emit({ type: "user", text: "new main busy" });
    await until(() => h.orch.busyCount() === 1);

    await h.orch.send("main", "after-swap");
    assert.deepEqual(next.sent, ["after-swap"]);
  } finally {
    await h.close();
  }
});
