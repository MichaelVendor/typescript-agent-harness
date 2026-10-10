import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import { createAttachmentStore } from "../dist/attachments/store.js";
import type { ChatHost, HostEvent, SessionEvent } from "../dist/host.js";
import { createServeHandler } from "../dist/serve/http.js";
import { createHub } from "../dist/serve/hub.js";
import { startServe } from "../dist/serve/run.js";

const TOKEN = "t".repeat(43);

/** Raw request, so tests can send any Host / Origin header. */
function raw(
  base: string,
  method: string,
  pathname: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const url = new URL(pathname, base);
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers: opts.headers }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (text += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

function client(base: string, cookie = "") {
  const origin = base.replace(/\/$/, "");
  return {
    get: (pathname: string) => raw(base, "GET", pathname, { headers: { cookie } }),
    post: (pathname: string, body: unknown = {}) =>
      raw(base, "POST", pathname, { headers: { cookie, origin, "content-type": "application/json" }, body }),
  };
}

/** An SSE connection; `until(type)` resolves with every event up to and including that type. */
function stream(base: string, cookie: string) {
  const events: HostEvent[] = [];
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
  const until = (type: HostEvent["type"], from = 0) =>
    new Promise<HostEvent[]>((resolve) => {
      const check = () => {
        const i = events.findIndex((e, n) => n >= from && e.type === type);
        if (i >= 0) resolve(events.slice(0, i + 1));
        else waiters.push(check);
      };
      check();
    });
  return { events, until, close: () => req.destroy() };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

const session: SessionEvent = { type: "session", id: "s1", resumed: false, history: [], hiddenTurns: 0 };

/** A ChatHost whose turns end only when the test says so. */
function fakeHost() {
  const listeners = new Set<(e: HostEvent) => void>();
  const emit = (e: HostEvent) => {
    for (const l of listeners) l(e);
  };
  const store = createAttachmentStore(mkdtempSync(path.join(tmpdir(), "tah-serve-att-")));
  let finish = () => {};
  const host: ChatHost = {
    sessionId: "s1",
    approve: true,
    on(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    async open() {
      emit(session);
    },
    snapshot: () => session,
    saveAttachment(input) {
      return store.save(input);
    },
    send(text, attachmentIds = []) {
      const refs = attachmentIds.length ? store.getMany(attachmentIds) : [];
      emit({
        type: "user",
        text: text || "(attachments)",
        ...(refs.length
          ? {
              attachments: refs.map(({ id, kind, name, mime, bytes, sha256 }) => ({
                id,
                kind,
                name,
                mime,
                bytes,
                sha256,
              })),
            }
          : {}),
      });
      return new Promise<void>((resolve) => {
        finish = () => {
          emit({ type: "turn.end", state: "idle", finishReason: "stop", rounds: 1 });
          resolve();
        };
      });
    },
    continueTurn: async () => {},
    cancel() {},
    answer(id, answer) {
      emit({ type: "approval.end", id, answer });
    },
    reset: async () => {},
    resume: async () => {},
    fork: async () => {},
    listSessions: async () => [],
    close: async () => {},
  };
  return { host, emit, finish: () => finish() };
}

async function fakeServer(webDir = path.join(tmpdir(), "tah-no-web")) {
  const fake = fakeHost();
  const hub = createHub(fake.host);
  await fake.host.open();
  const { handle, closeAll } = createServeHandler({
    host: fake.host,
    hub,
    token: TOKEN,
    info: { approve: true, maxSteps: null, version: "0.0.0", vision: false },
    webDir,
    persist: true,
  });
  const server = createServer(handle);
  const base = await listen(server);
  return {
    ...fake,
    base,
    cookie: `tah_token_${new URL(base).port}=${TOKEN}`,
    async close() {
      closeAll();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    },
  };
}

test("tah serve end to end: sign in, send, stream a turn, replay it to a new tab", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-serve-"));
  writeFileSync(path.join(cwd, "a.txt"), "x");
  const serve = await startServe({ ...parseArgv(["--mock", "--no-exec", "--quiet", "--port", "0", "serve"]), cwd });
  const base = serve.url.replace(/\?.*$/, "");
  const token = new URL(serve.url).searchParams.get("token") ?? "";
  try {
    const anon = client(base);
    assert.equal((await anon.get("/api/info")).status, 401);
    assert.equal((await anon.post("/api/auth", { token: "nope" })).status, 401);
    const signed = await anon.post("/api/auth", { token });
    assert.equal(signed.status, 204);
    const cookie = String(signed.headers["set-cookie"]).split(";")[0] ?? "";
    assert.match(String(signed.headers["set-cookie"]), /HttpOnly; SameSite=Strict/);
    const port = new URL(base).port;
    assert.equal(cookie, `tah_token_${port}=${token}`);
    assert.equal((await client(base, `tah_token_1=${token}`).get("/api/info")).status, 401);

    const api = client(base, cookie);
    assert.deepEqual(JSON.parse((await api.get("/api/info")).body), {
      approve: true,
      maxSteps: null,
      version: JSON.parse((await import("node:fs")).readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
      vision: false,
    });

    const tab = stream(base, cookie);
    await tab.until("session");
    assert.equal((await api.post("/api/send", { text: "看看目录" })).status, 202);
    const turn = await tab.until("turn.end");
    const types = turn.map((e) => e.type).filter((t, i, all) => t !== "text" || all[i - 1] !== "text");
    assert.deepEqual(types, ["session", "user", "tool.start", "tool.end", "text", "turn.end"]);

    const late = stream(base, cookie);
    const replay = await late.until("turn.end");
    assert.deepEqual(replay.map((e) => e.type), ["session", "turn.end"]);
    const history = (replay[0] as SessionEvent).history;
    assert.deepEqual(history[0], { role: "user", text: "看看目录" });
    assert.ok(history.some((h) => h.role === "assistant"));

    assert.ok(JSON.parse((await api.get("/api/sessions")).body).some((r: { id: string }) => r.id === serve.sessionId));
    tab.close();
    late.close();
  } finally {
    await serve.stop();
  }
});

test("Host, Origin and content-type are checked before anything else", async () => {
  const s = await fakeServer();
  try {
    const port = new URL(s.base).port;
    const bad = await raw(s.base, "GET", "/api/info", { headers: { host: `evil.example:${port}` } });
    assert.equal(bad.status, 403);
    const cross = await raw(s.base, "POST", "/api/auth", {
      headers: { origin: "http://evil.example", "content-type": "application/json" },
      body: { token: TOKEN },
    });
    assert.equal(cross.status, 403);
    const form = await raw(s.base, "POST", "/api/auth", {
      headers: { origin: s.base.replace(/\/$/, ""), "content-type": "text/plain" },
      body: { token: TOKEN },
    });
    assert.equal(form.status, 415);
  } finally {
    await s.close();
  }
});

test("a tab opened mid-turn gets the turn so far; approvals settle on every tab; busy is 409", async () => {
  const s = await fakeServer();
  const { cookie } = s;
  const api = client(s.base, cookie);
  try {
    const first = stream(s.base, cookie);
    await first.until("session");
    assert.equal((await api.post("/api/send", { text: "hi" })).status, 202);
    s.emit({ type: "text", delta: "Hel" });
    s.emit({ type: "text", delta: "lo" });
    s.emit({ type: "approval", id: "a1", tool: "write_file", input: { path: "x" } });

    assert.equal((await api.post("/api/send", { text: "again" })).status, 409);
    assert.equal((await api.post("/api/reset")).status, 409);

    const second = stream(s.base, cookie);
    const replay = await second.until("approval");
    assert.deepEqual(replay, [
      session,
      { type: "user", text: "hi" },
      { type: "text", delta: "Hello" },
      { type: "approval", id: "a1", tool: "write_file", input: { path: "x" } },
    ]);

    assert.equal((await api.post("/api/answer", { id: "a1", answer: "maybe" })).status, 400);
    assert.equal((await api.post("/api/answer", { id: "a1", answer: "yes" })).status, 204);
    const end = { type: "approval.end", id: "a1", answer: "yes" };
    assert.deepEqual((await first.until("approval.end")).at(-1), end);
    assert.deepEqual((await second.until("approval.end")).at(-1), end);

    const third = stream(s.base, cookie);
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(!third.events.some((e) => e.type === "approval"));

    s.finish();
    await first.until("turn.end");
    assert.equal((await api.post("/api/reset")).status, 204);
    for (const t of [first, second, third]) t.close();
  } finally {
    await s.close();
  }
});

test("upload attachment then send with attachmentIds", async () => {
  const s = await fakeServer();
  const { cookie, base } = s;
  const origin = base.replace(/\/$/, "");
  try {
    const denied = await raw(base, "POST", "/api/attachments", {
      headers: { origin, "content-type": "application/octet-stream", "x-tah-filename": "a.txt", "x-tah-mime": "text/plain" },
    });
    assert.equal(denied.status, 401);

    const uploaded = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        new URL("/api/attachments", base),
        {
          method: "POST",
          headers: {
            cookie,
            origin,
            "content-type": "application/octet-stream",
            "x-tah-filename": encodeURIComponent("note.txt"),
            "x-tah-mime": "text/plain",
            "content-length": Buffer.byteLength("hello"),
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => (text += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
        },
      );
      req.on("error", reject);
      req.end("hello");
    });
    assert.equal(uploaded.status, 201);
    const meta = JSON.parse(uploaded.body) as { id: string; name: string; kind: string };
    assert.equal(meta.name, "note.txt");
    assert.equal(meta.kind, "file");

    const tab = stream(base, cookie);
    await tab.until("session");
    const api = client(base, cookie);
    assert.equal((await api.post("/api/send", { text: "", attachmentIds: [meta.id] })).status, 202);
    const events = await tab.until("user");
    const user = events.find((e) => e.type === "user") as Extract<HostEvent, { type: "user" }>;
    assert.equal(user.attachments?.[0]?.id, meta.id);
    assert.equal(user.text, "(attachments)");
    s.finish();
    await tab.until("turn.end");
    tab.close();
  } finally {
    await s.close();
  }
});

test("static files stay inside the web directory; a missing build answers 503", async () => {
  const webDir = mkdtempSync(path.join(tmpdir(), "tah-web-"));
  writeFileSync(path.join(webDir, "index.html"), "<p>tah</p>");
  mkdirSync(path.join(webDir, "assets"));
  writeFileSync(path.join(webDir, "assets", "app.js"), "1");
  writeFileSync(path.join(path.dirname(webDir), "secret.js"), "no");
  const s = await fakeServer(webDir);
  const missing = await fakeServer();
  try {
    const index = await raw(s.base, "GET", "/sessions/whatever");
    assert.equal(index.status, 200);
    assert.equal(index.body, "<p>tah</p>");
    assert.match(String(index.headers["content-security-policy"]), /default-src 'self'/);
    assert.equal((await raw(s.base, "GET", "/assets/app.js")).headers["content-type"], "text/javascript; charset=utf-8");
    assert.equal((await raw(s.base, "GET", "/..%2fsecret.js")).status, 404);
    assert.equal((await raw(s.base, "GET", "/nope.js")).status, 404);
    assert.equal((await raw(s.base, "GET", "/api/nope", { headers: { cookie: s.cookie } })).status, 404);
    assert.equal((await raw(missing.base, "GET", "/")).status, 503);
  } finally {
    await s.close();
    await missing.close();
  }
});
