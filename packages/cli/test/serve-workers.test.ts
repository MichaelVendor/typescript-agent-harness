import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, request, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import type { ChatHost, HostEvent, SessionEvent } from "../dist/host.js";
import { createServeHandler } from "../dist/serve/http.js";
import { createHub } from "../dist/serve/hub.js";
import { createOrchestrator, type Orchestrator, type SpawnWorker } from "../dist/serve/orchestrator.js";
import type { ServeEvent } from "../dist/serve/protocol.js";
import { createWorkspaces } from "../dist/serve/workspaces.js";

const TOKEN = "w".repeat(43);

type FakeWorker = {
  cwd: string;
  token: string;
  calls: { route: string; body: Record<string, unknown> }[];
  emit(event: HostEvent): void;
};

function raw(
  base: string,
  method: string,
  pathname: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: string }> {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = request(base, { method, path: pathname, headers: opts.headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function client(base: string, cookie: string) {
  const origin = base.replace(/\/$/, "");
  return {
    get: (pathname: string) => raw(base, "GET", pathname, { headers: { cookie } }),
    post: (pathname: string, body: unknown = {}) =>
      raw(base, "POST", pathname, { headers: { cookie, origin, "content-type": "application/json" }, body }),
  };
}

function stream(base: string, cookie: string) {
  const events: ServeEvent[] = [];
  const waiters: Array<() => void> = [];
  const req = request(new URL("/api/events", base), { headers: { cookie } }, (res) => {
    let buffer = "";
    res.setEncoding("utf8");
    res.on("data", (chunk: string) => {
      buffer += chunk;
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const data = part.split("\n").find((l) => l.startsWith("data: "));
        if (data) events.push(JSON.parse(data.slice(6)));
      }
      for (const w of waiters.splice(0)) w();
    });
  });
  req.on("error", () => {});
  req.end();
  const until = (pred: (e: ServeEvent) => boolean, from = 0) =>
    new Promise<ServeEvent>((resolve) => {
      const check = () => {
        const e = events.find((x, i) => i >= from && pred(x));
        if (e) resolve(e);
        else waiters.push(check);
      };
      check();
    });
  return { events, until, close: () => req.destroy() };
}

async function until(pred: () => boolean, ms = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout waiting for condition");
    await new Promise((r) => setTimeout(r, 10));
  }
}

function fakeHost(sessionId = "main-s1") {
  const listeners = new Set<(e: HostEvent) => void>();
  const session: SessionEvent = { type: "session", id: sessionId, resumed: false, history: [], hiddenTurns: 0 };
  const emit = (e: HostEvent) => {
    for (const l of listeners) l(e);
  };
  const host = {
    sessionId,
    approve: true,
    permissionMode: "manual" as const,
    setPermissionMode() {},
    browser: undefined,
    on(l: (e: HostEvent) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async open() {
      emit(session);
    },
    snapshot: () => session,
    send: async () => {},
    sendQueued: async () => {},
    removeQueued() {},
    cancel() {},
    continueTurn: async () => {},
    compact: async () => {},
    answer() {},
    answerQuestion() {},
    skipQuestion() {},
    reset: async () => {},
    resume: async () => {},
    fork: async () => {},
    listSessions: async () => [],
    renameSession: async () => undefined,
    setSessionFlag: async () => {},
    reload: async () => {},
    saveAttachment: () => {
      throw new Error("no attachments");
    },
    skills: [],
    slashPrompts: [],
    close: async () => {},
  } as unknown as ChatHost;
  return { host, emit };
}

async function fakeWorkersServer() {
  const fake = fakeHost();
  const hub = createHub(fake.host);
  await fake.host.open();
  const home = mkdtempSync(path.join(tmpdir(), "tah-sw-home-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sw-cwd-"));
  const workspaces = createWorkspaces({
    cwd,
    home,
    host: fake.host,
    hub,
    createHost: async () => fakeHost("other").host,
    readSessions: async () => [],
  });

  const workers: FakeWorker[] = [];
  const servers: Server[] = [];
  const spawnWorker: SpawnWorker = async ({ cwd: wCwd, token }) => {
    const sse = new Set<ServerResponse>();
    const w: FakeWorker = {
      cwd: wCwd,
      token,
      calls: [],
      emit(event) {
        for (const res of sse) res.write(`data: ${JSON.stringify(event)}\n\n`);
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
            id: `sess-${wCwd}`,
            resumed: false,
            history: [],
            hiddenTurns: 0,
          }),
        );
        return;
      }
      let rawBody = "";
      req.on("data", (c) => (rawBody += c));
      req.on("end", () => {
        w.calls.push({ route, body: rawBody ? JSON.parse(rawBody) : {} });
        res.writeHead(202).end();
      });
    });
    servers.push(server);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    workers.push(w);
    return {
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      kill() {
        for (const res of sse) res.end();
        server.closeAllConnections();
        server.close();
      },
    };
  };

  const orch: Orchestrator = createOrchestrator({
    main: fake.host,
    mainCwd: cwd,
    flags: parseArgv(["--mock"]),
    homeDir: home,
    spawnWorker,
  });

  const { handle, closeAll } = createServeHandler({
    workspaces,
    hub,
    token: TOKEN,
    info: { approve: true, maxSteps: null, version: "0.0.0", vision: false, desktop: "/unused" },
    webDir: path.join(tmpdir(), "tah-no-web"),
    persist: true,
    home,
    orchestrator: orch,
  });
  const server = createServer(handle);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const cookie = `tah_token_${new URL(base).port}=${TOKEN}`;
  return {
    base,
    cookie,
    api: client(base, cookie),
    workers,
    orch,
    main: fake,
    async close() {
      closeAll();
      await orch.dispose();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      for (const s of servers) {
        s.closeAllConnections();
        s.close();
      }
    },
  };
}

test("GET /api/workers lists main; parallel two sends both complete", async () => {
  const h = await fakeWorkersServer();
  try {
    const listed = await h.api.get("/api/workers");
    assert.equal(listed.status, 200);
    const body = JSON.parse(listed.body) as { workers: { id: string }[]; focusId: string };
    assert.equal(body.focusId, "main");
    assert.equal(body.workers.length, 1);
    assert.equal(body.workers[0]?.id, "main");

    const a = JSON.parse((await h.api.post("/api/workers/parallel", { cwd: "/tmp/wa" })).body) as { id: string };
    const b = JSON.parse((await h.api.post("/api/workers/parallel", { cwd: "/tmp/wb" })).body) as { id: string };
    assert.notEqual(a.id, b.id);

    assert.equal((await h.api.post("/api/send", { text: "a", workerId: a.id })).status, 202);
    assert.equal((await h.api.post("/api/send", { text: "b", workerId: b.id })).status, 202);
    assert.ok(h.workers[0]?.calls.some((c) => c.route === "/send" && c.body.text === "a"));
    assert.ok(h.workers[1]?.calls.some((c) => c.route === "/send" && c.body.text === "b"));

    await new Promise((r) => setTimeout(r, 80));
    h.workers[0]?.emit({ type: "user", text: "a" });
    h.workers[1]?.emit({ type: "user", text: "b" });
    await until(() => h.orch.busyCount() === 2);
    h.workers[0]?.emit({ type: "turn.end", state: "done", finishReason: "stop", rounds: 1 });
    h.workers[1]?.emit({ type: "turn.end", state: "done", finishReason: "stop", rounds: 1 });
    await until(() => h.orch.busyCount() === 0);
  } finally {
    await h.close();
  }
});

test("background approval → attention; answer without focus 409; focus then ok", async () => {
  const h = await fakeWorkersServer();
  const sse = stream(h.base, h.cookie);
  try {
    await sse.until((e) => e.type === "workers");
    const created = JSON.parse((await h.api.post("/api/workers/parallel", { cwd: "/tmp/wa" })).body) as {
      id: string;
    };
    await new Promise((r) => setTimeout(r, 100));

    h.workers[0]?.emit({ type: "approval", id: "ap1", tool: "bash", input: { cmd: "ls" } });
    const attention = await sse.until(
      (e) => e.type === "attention" && e.workerId === created.id && e.kind === "approval",
    );
    assert.equal(attention.type, "attention");
    if (attention.type === "attention") assert.match(attention.summary, /bash|ap1|approval/i);

    const denied = await h.api.post("/api/answer", { id: "ap1", answer: "yes", workerId: created.id });
    assert.equal(denied.status, 409);
    assert.match(JSON.parse(denied.body).error, /focus/i);

    assert.equal((await h.api.post("/api/workers/focus", { id: created.id })).status, 204);
    assert.equal(h.orch.focusId, created.id);

    const ok = await h.api.post("/api/answer", { id: "ap1", answer: "yes", workerId: created.id });
    assert.equal(ok.status, 204);
    assert.ok(h.workers[0]?.calls.some((c) => c.route === "/answer" && c.body.id === "ap1"));
  } finally {
    sse.close();
    await h.close();
  }
});

test("5th busy worker send returns 409", async () => {
  const h = await fakeWorkersServer();
  try {
    h.main.emit({ type: "user", text: "busy main" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const w = JSON.parse((await h.api.post("/api/workers/parallel", { cwd: `/tmp/w${i}` })).body) as { id: string };
      ids.push(w.id);
    }
    await new Promise((r) => setTimeout(r, 80));
    for (const id of ids) {
      assert.equal((await h.api.post("/api/send", { text: "go", workerId: id })).status, 202);
    }
    await until(() => h.orch.busyCount() === 4);

    const fifth = await h.api.post("/api/workers/parallel", { cwd: "/tmp/w-extra" });
    assert.equal(fifth.status, 409);
    assert.match(JSON.parse(fifth.body).error, /too many busy/);

    h.main.emit({ type: "turn.end", state: "done", finishReason: "stop", rounds: 1 });
    await until(() => h.orch.busyCount() === 3);
    const ok = JSON.parse((await h.api.post("/api/workers/parallel", { cwd: "/tmp/w-extra" })).body) as { id: string };
    assert.equal((await h.api.post("/api/send", { text: "go", workerId: ok.id })).status, 202);
    await until(() => h.orch.busyCount() === 4);
    const over = await h.api.post("/api/send", { text: "nope", workerId: "main" });
    assert.equal(over.status, 409);
    assert.match(JSON.parse(over.body).error, /too many busy/);
  } finally {
    await h.close();
  }
});

test("GET /api/session-status fills workers from orch.snapshot", async () => {
  const h = await fakeWorkersServer();
  try {
    const res = await h.api.get("/api/session-status");
    assert.equal(res.status, 200);
    const body = JSON.parse(res.body) as {
      cwd: string;
      workers: Array<{ workerId: string; busy: boolean }>;
    };
    assert.ok(body.workers.some((w) => w.workerId === "main"));
    assert.equal(body.cwd, h.orch.snapshot().workers.find((w) => w.workerId === "main")?.cwd);

    const a = JSON.parse((await h.api.post("/api/workers/parallel", { cwd: "/tmp/wa-status" })).body) as {
      id: string;
    };
    const after = JSON.parse((await h.api.get("/api/session-status")).body) as {
      workers: Array<{ workerId: string }>;
    };
    assert.ok(after.workers.some((w) => w.workerId === a.id));
  } finally {
    await h.close();
  }
});
