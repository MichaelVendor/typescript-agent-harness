import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import { createAttachmentStore } from "../dist/attachments/store.js";
import type { ChatHost, HostEvent, SessionEvent } from "../dist/host.js";
import { chooseFolder, UnsupportedError } from "../dist/serve/choose.js";
import { createServeHandler } from "../dist/serve/http.js";
import { createHub } from "../dist/serve/hub.js";
import { startServe } from "../dist/serve/run.js";
import { createWorkspaces } from "../dist/serve/workspaces.js";

const TOKEN = "t".repeat(43);

/** Raw request, so tests can send any Host / Origin header and the path as written. */
function raw(
  base: string,
  method: string,
  pathname: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  return new Promise((resolve, reject) => {
    const req = request(base, { method, path: pathname, headers: opts.headers }, (res) => {
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
  let reloads = 0;
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
        text,
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
    renameSession: async () => undefined,
    setSessionFlag: async () => {},
    reload: async () => {
      reloads++;
    },
    close: async () => {},
  };
  return { host, emit, finish: () => finish(), reloads: () => reloads };
}

async function fakeServer(
  webDir = path.join(tmpdir(), "tah-no-web"),
  chooseFolder: (start?: string) => Promise<string | null> = async () => null,
) {
  const fake = fakeHost();
  const hub = createHub(fake.host);
  await fake.host.open();
  const home = mkdtempSync(path.join(tmpdir(), "tah-serve-home-"));
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-serve-cwd-"));
  const workspaces = createWorkspaces({
    cwd,
    home,
    host: fake.host,
    hub,
    createHost: async () => fakeHost().host,
    readSessions: async () => [],
  });
  const { handle, closeAll } = createServeHandler({
    workspaces,
    hub,
    token: TOKEN,
    info: { approve: true, maxSteps: null, version: "0.0.0", vision: false, desktop: "/unused" },
    webDir,
    persist: true,
    home,
    chooseFolder,
  });
  const server = createServer(handle);
  const base = await listen(server);
  return {
    ...fake,
    base,
    home,
    cwd,
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
  const home = mkdtempSync(path.join(tmpdir(), "tah-serve-home-"));
  const serve = await startServe(
    { ...parseArgv(["--mock", "--no-exec", "--quiet", "--port", "0", "serve"]), cwd },
    { homeDir: home },
  );
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
      desktop: home,
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
    assert.equal((await api.post("/api/session-flag", { id: serve.sessionId, flag: "starred", on: true })).status, 400);
    assert.equal((await api.post("/api/session-flag", { id: serve.sessionId, flag: "pinned", on: true })).status, 204);
    const pinned = JSON.parse((await api.get("/api/sessions")).body).find((r: { id: string }) => r.id === serve.sessionId);
    assert.equal(pinned.pinned, true);

    const aId = serve.sessionId;
    const b = mkdtempSync(path.join(tmpdir(), "tah-serve-b-"));
    assert.equal((await api.post("/api/workspaces/add", { path: b })).status, 204);
    const from = tab.events.length;
    assert.equal((await api.post("/api/reset", { cwd: b })).status, 204);
    const inB = (await tab.until("session", from)).at(-1) as SessionEvent;
    assert.notEqual(inB.id, aId);
    assert.equal(serve.sessionId, inB.id);
    const views = JSON.parse((await api.get("/api/workspaces")).body) as Array<{ path: string; active: boolean; sessions: Array<{ id: string }> }>;
    assert.deepEqual(views.map((v) => [v.path, v.active]), [
      [path.resolve(cwd), false],
      [path.resolve(b), true],
    ]);
    assert.ok(views[0]?.sessions.some((s) => s.id === aId));
    assert.equal(views[1]?.sessions.length, 1, "switching reuses the empty session it opened");
    assert.ok(existsSync(path.join(b, ".tah", "cli.db")));

    assert.equal((await api.post("/api/resume", { ref: aId, cwd })).status, 204);
    assert.equal(serve.sessionId, aId);
    assert.equal(JSON.parse((await api.get("/api/workspaces")).body)[0].active, true);

    writeFileSync(path.join(b, "package.json"), JSON.stringify({ devDependencies: { "@typescript-agent-harness/cli": "*" } }));
    writeFileSync(path.join(b, "tah.config.json"), "{");
    assert.equal((await api.post("/api/reset", { cwd: b })).status, 400);
    assert.equal(JSON.parse((await api.get("/api/workspaces")).body)[0].active, true);
    assert.equal((await api.post("/api/workspaces/remove", { path: cwd })).status, 409);
    assert.equal((await api.post("/api/workspaces/remove", { path: b })).status, 204);
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
    assert.equal(user.text, "");
    assert.ok(user.attachments?.length);
    s.finish();
    await tab.until("turn.end");
    tab.close();
  } finally {
    await s.close();
  }
});

test("folder browser lists sub-folders only and creates folders", async () => {
  const s = await fakeServer();
  const api = client(s.base, s.cookie);
  try {
    mkdirSync(path.join(s.home, "proj"));
    mkdirSync(path.join(s.home, ".hidden"));
    writeFileSync(path.join(s.home, "note.txt"), "x");
    const listing = JSON.parse((await api.get("/api/fs")).body);
    assert.equal(listing.path, s.home);
    assert.deepEqual(listing.dirs, ["proj"]);
    const inner = JSON.parse((await api.get(`/api/fs?path=${encodeURIComponent(path.join(s.home, "proj"))}`)).body);
    assert.deepEqual(inner.dirs, []);
    assert.equal((await api.get(`/api/fs?path=${encodeURIComponent(path.join(s.home, "nope"))}`)).status, 400);
    const made = await api.post("/api/fs/mkdir", { path: s.home, name: "fresh" });
    assert.equal(made.status, 201);
    assert.equal(JSON.parse(made.body).path, path.join(s.home, "fresh"));
    assert.equal((await api.post("/api/fs/mkdir", { path: s.home, name: "../x" })).status, 400);
    assert.equal((await api.post("/api/fs/mkdir", { path: s.home, name: "fresh" })).status, 400);
  } finally {
    await s.close();
  }
});

test("native folder chooser: picked path, cancel, unsupported, one at a time", async () => {
  let answer: () => Promise<string | null> = async () => "/picked/dir";
  const starts: (string | undefined)[] = [];
  const s = await fakeServer(undefined, async (start) => {
    starts.push(start);
    return answer();
  });
  const api = client(s.base, s.cookie);
  try {
    const picked = await api.post("/api/fs/choose", { start: "/from" });
    assert.equal(picked.status, 200);
    assert.deepEqual(JSON.parse(picked.body), { path: "/picked/dir" });
    assert.deepEqual(starts, ["/from"]);

    answer = async () => null;
    assert.deepEqual(JSON.parse((await api.post("/api/fs/choose", {})).body), { path: null });

    answer = async () => {
      throw new UnsupportedError("no native folder dialog on this platform");
    };
    assert.equal((await api.post("/api/fs/choose", {})).status, 501);

    let release!: (v: string | null) => void;
    answer = () => new Promise((r) => (release = r));
    const first = api.post("/api/fs/choose", {});
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await api.post("/api/fs/choose", {})).status, 409);
    release(null);
    assert.equal((await first).status, 200);
  } finally {
    await s.close();
  }
});

test("chooseFolder: Windows FolderBrowserDialog via PowerShell; empty output is cancel", async () => {
  const calls: string[][] = [];
  const run = (stdout: string) => async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    return { code: 0, stdout, stderr: "" };
  };
  assert.equal(await chooseFolder("C:\\Users\\o'neil", { platform: "win32", run: run("C:\\Users\\me\\项目\r\n") }), "C:\\Users\\me\\项目");
  const [cmd, ...args] = calls[0] ?? [];
  assert.equal(cmd, "powershell.exe");
  assert.deepEqual(args.slice(0, 4), ["-NoProfile", "-NonInteractive", "-STA", "-EncodedCommand"]);
  const script = Buffer.from(args[4] ?? "", "base64").toString("utf16le");
  assert.match(script, /FolderBrowserDialog/);
  assert.match(script, /ShowNewFolderButton = \$true/);
  assert.match(script, /SelectedPath = 'C:\\Users\\o''neil'/);
  assert.equal(await chooseFolder(undefined, { platform: "win32", run: run("") }), null);
});

test("chooseFolder: macOS choose folder dialog; cancel is null; other platforms unsupported", async () => {
  const calls: string[][] = [];
  const run = (result: { code: number; stdout: string; stderr: string }) => async (cmd: string, args: string[]) => {
    calls.push([cmd, ...args]);
    return result;
  };
  assert.equal(
    await chooseFolder('/Users/me/"x"', { platform: "darwin", run: run({ code: 0, stdout: "/Users/me/picked/\n", stderr: "" }) }),
    "/Users/me/picked",
  );
  assert.equal(calls[0]?.[0], "osascript");
  assert.match(calls[0]?.join(" ") ?? "", /choose folder .*default location \(POSIX file "\/Users\/me\/\\"x\\""\)/);
  assert.equal(
    await chooseFolder(undefined, { platform: "darwin", run: run({ code: 1, stdout: "", stderr: "execution error: User canceled. (-128)" }) }),
    null,
  );
  await assert.rejects(
    chooseFolder(undefined, { platform: "darwin", run: run({ code: 1, stdout: "", stderr: "boom" }) }),
    /boom/,
  );
  await assert.rejects(chooseFolder(undefined, { platform: "linux", run: run({ code: 0, stdout: "", stderr: "" }) }), UnsupportedError);
});

test("settings: add / switch / remove models; keys never come back; the host reloads when the active model changes", async () => {
  const s = await fakeServer();
  const api = client(s.base, s.cookie);
  const view = async () => JSON.parse((await api.get("/api/settings")).body);
  try {
    const empty = await view();
    assert.equal(typeof empty.user, "string");
    assert.deepEqual([empty.models, empty.activeModel], [[], null]);

    const first = await api.post("/api/settings/models", { model: "deepseek-chat", apiKey: "sk-first-1234" });
    assert.equal(first.status, 200);
    assert.equal(s.reloads(), 1);
    await api.post("/api/settings/models", { model: "gpt-4o", apiKey: "sk-second-5678", baseURL: "https://example.com/v1" });
    assert.equal(s.reloads(), 1);

    const two = await view();
    assert.deepEqual(
      two.models.map((m: { model: string; baseURL: string; keyHint: string }) => [m.model, m.baseURL, m.keyHint]),
      [
        ["deepseek-chat", "https://api.deepseek.com/v1", "sk-…1234"],
        ["gpt-4o", "https://example.com/v1", "sk-…5678"],
      ],
    );
    assert.doesNotMatch(JSON.stringify(two), /sk-first|sk-second/);
    assert.equal(two.activeModel, two.models[0].id);

    assert.equal((await api.post("/api/settings/active", { id: two.models[1].id })).status, 200);
    assert.equal(s.reloads(), 2);
    assert.equal((await api.post("/api/settings/active", { id: "nope" })).status, 400);
    assert.equal((await api.post("/api/settings/models", { model: "x", apiKey: "" })).status, 400);

    assert.equal((await api.post("/api/settings/models/remove", { id: two.models[1].id })).status, 200);
    assert.equal(s.reloads(), 3);
    assert.equal((await view()).activeModel, null);

    await api.post("/api/send", { text: "hi" });
    assert.equal((await api.post("/api/settings/active", { id: two.models[0].id })).status, 409);
    s.finish();
  } finally {
    await s.close();
  }
});

test("settings: the Tavily key is saved, hinted, and removed; the host reloads", async () => {
  const prev = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  const s = await fakeServer();
  const api = client(s.base, s.cookie);
  try {
    assert.equal(JSON.parse((await api.get("/api/settings")).body).search, null);

    const saved = await api.post("/api/settings/search", { apiKey: "tvly-secret-9876" });
    assert.equal(saved.status, 200);
    assert.deepEqual(JSON.parse(saved.body).search, { source: "settings", keyHint: "tvl…9876" });
    assert.doesNotMatch(saved.body, /tvly-secret/);
    assert.equal(s.reloads(), 1);

    assert.equal((await api.post("/api/settings/search", { apiKey: "" })).status, 400);
    assert.equal((await api.post("/api/settings/search", { apiKey: 42 })).status, 400);

    const removed = await api.post("/api/settings/search", { apiKey: null });
    assert.equal(JSON.parse(removed.body).search, null);
    assert.equal(s.reloads(), 2);

    await api.post("/api/send", { text: "hi" });
    assert.equal((await api.post("/api/settings/search", { apiKey: "tvly-x" })).status, 409);
    s.finish();
  } finally {
    await s.close();
    if (prev !== undefined) process.env.TAVILY_API_KEY = prev;
  }
});

test("settings: models are marked as reading images; changing the active one reloads the host", async () => {
  const s = await fakeServer();
  const api = client(s.base, s.cookie);
  const view = async () => JSON.parse((await api.get("/api/settings")).body);
  try {
    await api.post("/api/settings/models", { model: "gpt-4o", apiKey: "sk-first-1234", vision: true });
    await api.post("/api/settings/models", { model: "deepseek-chat", apiKey: "sk-second-5678" });
    const [a, b] = (await view()).models as { id: string; model: string; vision: boolean }[];
    assert.deepEqual([a!.vision, b!.vision], [true, false]);
    assert.equal(s.reloads(), 1);

    assert.equal((await api.post("/api/settings/models/vision", { id: b!.id, vision: true })).status, 200);
    assert.equal(s.reloads(), 1);
    const off = await api.post("/api/settings/models/vision", { id: a!.id, vision: false });
    assert.deepEqual(
      JSON.parse(off.body).models.map((m: { vision: boolean }) => m.vision),
      [false, true],
    );
    assert.equal(s.reloads(), 2);

    assert.equal((await api.post("/api/settings/models/vision", { id: a!.id, vision: "yes" })).status, 400);
    assert.equal((await api.post("/api/settings/models/vision", { id: "nope", vision: true })).status, 400);
    await api.post("/api/send", { text: "hi" });
    assert.equal((await api.post("/api/settings/models/vision", { id: a!.id, vision: true })).status, 409);
    s.finish();
  } finally {
    await s.close();
  }
});

test("settings: env names the .env model and its key variable, never the key", async () => {
  const names = ["DEEPSEEK_API_KEY", "DEEPSEEK_MODEL", "OPENAI_API_KEY", "OPENAI_MODEL"];
  const prev = names.map((n) => process.env[n]);
  for (const n of names) delete process.env[n];
  const s = await fakeServer();
  const api = client(s.base, s.cookie);
  const env = async () => JSON.parse((await api.get("/api/settings")).body).env;
  try {
    assert.equal(await env(), null);
    process.env.OPENAI_API_KEY = "sk-openai-1111";
    assert.deepEqual(await env(), { model: "gpt-4o-mini", key: "OPENAI_API_KEY" });
    process.env.DEEPSEEK_API_KEY = "sk-deep-2222";
    process.env.DEEPSEEK_MODEL = "deepseek-reasoner";
    const body = (await api.get("/api/settings")).body;
    assert.deepEqual(JSON.parse(body).env, { model: "deepseek-reasoner", key: "DEEPSEEK_API_KEY" });
    assert.doesNotMatch(body, /sk-openai|sk-deep/);
  } finally {
    await s.close();
    names.forEach((n, i) => (prev[i] === undefined ? delete process.env[n] : (process.env[n] = prev[i])));
  }
});

test("skills: list home + folder skills; import one or a folder of them (symlinks copied); remove home ones", async () => {
  const s = await fakeServer();
  const api = client(s.base, s.cookie);
  const skill = (dir: string, name: string) => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: Does ${name}.\n---\nbody\n`);
  };
  try {
    skill(path.join(s.cwd, "skills", "local"), "local");
    const from = path.join(s.home, "cursor-skills");
    skill(path.join(from, "good"), "good");
    skill(path.join(s.home, "real", "linked"), "linked");
    symlinkSync(path.join(s.home, "real", "linked"), path.join(from, "linked"));
    mkdirSync(path.join(from, "bad"));
    writeFileSync(path.join(from, "bad", "SKILL.md"), "no frontmatter\n");
    mkdirSync(path.join(from, "not-a-skill"));

    const all = await api.post("/api/skills/import", { path: from });
    assert.equal(all.status, 200);
    const body = JSON.parse(all.body);
    assert.deepEqual(body.imported.sort(), ["good", "linked"]);
    assert.deepEqual(body.skipped, ["bad: missing YAML frontmatter"]);
    assert.equal(s.reloads(), 1);
    assert.ok(lstatSync(path.join(s.home, ".tah", "skills", "linked")).isDirectory());

    const again = JSON.parse((await api.post("/api/skills/import", { path: path.join(from, "good") })).body);
    assert.deepEqual([again.imported, again.skipped], [[], ["good: already installed"]]);
    assert.equal(s.reloads(), 1);
    assert.equal((await api.post("/api/skills/import", { path: path.join(from, "not-a-skill") })).status, 400);

    const listed = JSON.parse((await api.get("/api/skills")).body).skills.map((k: { name: string; source: string }) => [k.name, k.source]);
    assert.deepEqual(listed, [["good", "home"], ["linked", "home"], ["local", "folder"]]);

    assert.equal((await api.post("/api/skills/remove", { name: "good" })).status, 200);
    assert.equal(s.reloads(), 2);
    assert.equal(existsSync(path.join(s.home, ".tah", "skills", "good")), false);
    assert.equal((await api.post("/api/skills/remove", { name: "local" })).status, 400);
    assert.equal((await api.post("/api/skills/remove", { name: "../x" })).status, 400);

    await api.post("/api/send", { text: "hi" });
    assert.equal((await api.post("/api/skills/remove", { name: "linked" })).status, 409);
    s.finish();
  } finally {
    await s.close();
  }
});

test("recent projects: folders removed from the sidebar that still exist", async () => {
  const s = await fakeServer();
  const api = client(s.base, s.cookie);
  try {
    const kept = path.join(s.home, "kept");
    const gone = path.join(s.home, "gone");
    mkdirSync(kept);
    mkdirSync(gone);
    for (const dir of [kept, gone]) {
      assert.equal((await api.post("/api/workspaces/add", { path: dir })).status, 204);
      assert.equal((await api.post("/api/workspaces/remove", { path: dir })).status, 204);
    }
    rmSync(gone, { recursive: true });
    assert.deepEqual(JSON.parse((await api.get("/api/workspaces/recent")).body), [{ path: kept, name: "kept" }]);
    await api.post("/api/workspaces/add", { path: kept });
    assert.deepEqual(JSON.parse((await api.get("/api/workspaces/recent")).body), []);
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

const q = (p: string) => encodeURIComponent(p);

test("files: stat and raw read inside the open folder only", async () => {
  const s = await fakeServer();
  try {
    mkdirSync(path.join(s.cwd, "docs"));
    writeFileSync(path.join(s.cwd, "docs", "a.md"), "# hi");
    writeFileSync(path.join(s.cwd, "data.bin"), Buffer.from([1, 0, 2]));
    writeFileSync(path.join(s.cwd, "notes"), "plain");
    writeFileSync(path.join(s.cwd, "doc.pdf"), "%PDF-1.4");
    const outside = mkdtempSync(path.join(tmpdir(), "tah-serve-out-"));
    writeFileSync(path.join(outside, "secret.txt"), "s");
    symlinkSync(path.join(outside, "secret.txt"), path.join(s.cwd, "link.txt"));
    const anon = client(s.base);
    const api = client(s.base, s.cookie);

    assert.equal((await anon.get(`/api/files/stat?path=${q("docs/a.md")}`)).status, 401);
    assert.equal((await anon.get(`/api/files/raw?path=${q("docs/a.md")}`)).status, 401);

    const md = await api.get(`/api/files/stat?path=${q("docs/a.md")}`);
    assert.equal(md.status, 200);
    const view = JSON.parse(md.body);
    assert.equal(view.path, "docs/a.md");
    assert.equal(view.kind, "markdown");
    assert.equal(view.bytes, 4);
    assert.ok(Number.isInteger(view.mtime));
    assert.equal("previewURL" in view, false);
    assert.equal(JSON.parse((await api.get(`/api/files/stat?path=${q(path.join(s.cwd, "docs", "a.md"))}`)).body).path, "docs/a.md");
    assert.equal(JSON.parse((await api.get("/api/files/stat?path=data.bin")).body).kind, "binary");
    assert.equal(JSON.parse((await api.get("/api/files/stat?path=notes")).body).kind, "text");

    for (const bad of [path.relative(s.cwd, path.join(outside, "secret.txt")), path.join(outside, "secret.txt"), "link.txt", "docs", "missing.txt"]) {
      const r = await api.get(`/api/files/stat?path=${q(bad)}`);
      assert.equal(r.status, 404, bad);
      assert.deepEqual(JSON.parse(r.body), { error: "not found in this folder" });
      assert.equal((await api.get(`/api/files/raw?path=${q(bad)}`)).status, 404, bad);
    }
    assert.equal((await api.get("/api/files/stat")).status, 400);

    const body = await api.get(`/api/files/raw?path=${q("docs/a.md")}&v=${view.mtime}`);
    assert.equal(body.status, 200);
    assert.equal(body.body, "# hi");
    assert.equal(body.headers["content-type"], "text/markdown; charset=utf-8");
    assert.equal(body.headers["x-content-type-options"], "nosniff");
    assert.equal(body.headers["content-security-policy"], "sandbox");
    assert.equal(body.headers["cache-control"], "no-cache");
    const pdf = await api.get("/api/files/raw?path=doc.pdf");
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.equal(pdf.headers["content-security-policy"], undefined);
  } finally {
    await s.close();
  }
});

test("files: raw honours one Range", async () => {
  const s = await fakeServer();
  try {
    writeFileSync(path.join(s.cwd, "v.mp4"), "0123456789");
    const get = (range: string) =>
      raw(s.base, "GET", "/api/files/raw?path=v.mp4", { headers: { cookie: s.cookie, range } });
    const part = await get("bytes=2-5");
    assert.equal(part.status, 206);
    assert.equal(part.body, "2345");
    assert.equal(part.headers["content-range"], "bytes 2-5/10");
    assert.equal(part.headers["accept-ranges"], "bytes");
    assert.equal((await get("bytes=-3")).body, "789");
    assert.equal((await get("bytes=8-")).body, "89");
    assert.equal((await get("bytes=20-")).status, 416);
    assert.equal((await get("bytes=0-1,4-5")).status, 416);

    writeFileSync(path.join(s.cwd, "empty.txt"), "");
    const empty = await raw(s.base, "GET", "/api/files/raw?path=empty.txt", { headers: { cookie: s.cookie } });
    assert.equal(empty.status, 200);
    assert.equal(empty.headers["content-length"], "0");
    assert.equal(empty.body, "");
  } finally {
    await s.close();
  }
});

test("files: attachments by id; unknown or malformed ids are not found", async () => {
  const s = await fakeServer();
  try {
    const ref = createAttachmentStore(s.cwd).save({ name: "shot.png", mime: "image/png", data: Buffer.from("png") });
    const api = client(s.base, s.cookie);
    const view = JSON.parse((await api.get(`/api/files/stat?attachment=${ref.id}`)).body);
    assert.equal(view.kind, "image");
    assert.equal(view.path, `.tah/attachments/objects/${ref.sha256}/shot.png`);
    assert.equal((await api.get(`/api/files/raw?attachment=${ref.id}`)).body, "png");
    assert.equal((await api.get("/api/files/stat?attachment=nope")).status, 404);
    assert.equal((await api.get(`/api/files/stat?attachment=${q("../../x")}`)).status, 404);
  } finally {
    await s.close();
  }
});

test("preview: html and its folder files under a preview token, sandboxed, without the sign-in cookie", async () => {
  const s = await fakeServer();
  try {
    mkdirSync(path.join(s.cwd, "site"));
    writeFileSync(path.join(s.cwd, "site", "index.html"), '<link rel="stylesheet" href="style.css"><p>hi</p>');
    writeFileSync(path.join(s.cwd, "site", "style.css"), "p{color:red}");
    const outside = mkdtempSync(path.join(tmpdir(), "tah-serve-out-"));
    writeFileSync(path.join(outside, "secret.txt"), "s");
    symlinkSync(path.join(outside, "secret.txt"), path.join(s.cwd, "site", "link.txt"));
    const api = client(s.base, s.cookie);
    const anon = client(s.base);

    const view = JSON.parse((await api.get("/api/files/stat?path=site/index.html")).body);
    assert.equal(view.kind, "html");
    assert.match(view.previewURL, /^\/preview\/[\w-]{43}\/site\/index\.html$/);

    const page = await anon.get(view.previewURL);
    assert.equal(page.status, 200);
    assert.match(page.body, /<p>hi<\/p>/);
    assert.equal(page.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(page.headers["content-security-policy"], "sandbox allow-scripts allow-forms allow-popups allow-modals");
    assert.equal(page.headers["x-content-type-options"], "nosniff");
    const css = await anon.get(view.previewURL.replace("index.html", "style.css"));
    assert.equal(css.status, 200);
    assert.equal(css.headers["content-type"], "text/css; charset=utf-8");

    assert.equal((await anon.get(view.previewURL.replace("index.html", "link.txt"))).status, 404);
    assert.equal((await anon.get(view.previewURL.replace(/^\/preview\/[^/]+/, `/preview/${"x".repeat(43)}`))).status, 404);
    assert.equal((await anon.get(view.previewURL.replace(/^\/preview\/[^/]+/, "/preview/short"))).status, 404);
    assert.equal((await raw(s.base, "POST", view.previewURL)).status, 405);

    const head = await raw(s.base, "HEAD", view.previewURL);
    assert.equal(head.status, 200);
    assert.equal(head.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(head.headers["content-security-policy"], "sandbox allow-scripts allow-forms allow-popups allow-modals");
    assert.equal(head.body, "");

    const token = view.previewURL.split("/")[2];
    for (const bad of ["..%2F..%2Fetc%2Fpasswd", "", "site/", "/etc/passwd"]) {
      const r = await raw(s.base, "GET", `/preview/${token}/${bad}`);
      assert.equal(r.status, 404, bad);
      assert.deepEqual(JSON.parse(r.body), { error: "not found in this folder" }, bad);
    }
    // The URL parser turns `%2e%2e` segments into `..`, so this leaves /preview for /etc/passwd (web UI not built here).
    assert.equal((await raw(s.base, "GET", `/preview/${token}/%2e%2e/%2e%2e/etc/passwd`)).status, 503);
  } finally {
    await s.close();
  }
});

test("files: after switching folders only the new folder is readable", async () => {
  const s = await fakeServer();
  try {
    writeFileSync(path.join(s.cwd, "old.txt"), "old");
    const other = mkdtempSync(path.join(tmpdir(), "tah-serve-other-"));
    writeFileSync(path.join(other, "new.txt"), "new");
    const api = client(s.base, s.cookie);
    assert.equal((await api.post("/api/workspaces/add", { path: other })).status, 204);
    assert.equal((await api.post("/api/reset", { cwd: other })).status, 204);
    assert.equal((await api.get("/api/files/stat?path=old.txt")).status, 404);
    assert.equal((await api.get("/api/files/stat?path=new.txt")).status, 200);
  } finally {
    await s.close();
  }
});
