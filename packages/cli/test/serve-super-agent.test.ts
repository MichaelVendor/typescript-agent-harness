import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createMockChannel } from "@typescript-agent-harness/channels";
import { parseArgv } from "../dist/args.js";
import type { ChatHost, HostEvent } from "../dist/host.js";
import { startServe } from "../dist/serve/run.js";
import { createSuperAgentChat } from "../dist/serve/super-agent-chat.js";

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
      raw(base, "POST", pathname, {
        headers: { cookie, origin, "content-type": "application/json" },
        body,
      }),
  };
}

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

test("parseArgv --super-agent enables chat + default panel dir", () => {
  const flags = parseArgv(["serve", "--super-agent"]);
  assert.equal(flags.command, "serve");
  assert.equal(flags.superAgent, true);
  assert.equal(flags.superAgentPanel, ".tah/super-agent");
});

test("parseArgv --super-agent keeps explicit --super-agent-panel", () => {
  const flags = parseArgv(["serve", "--super-agent", "--super-agent-panel", ".tah/custom"]);
  assert.equal(flags.superAgent, true);
  assert.equal(flags.superAgentPanel, ".tah/custom");
});

test("tah serve --super-agent: web send → Super-agent reply + panel", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sa-serve-"));
  const home = mkdtempSync(path.join(tmpdir(), "tah-sa-serve-home-"));
  const flags = {
    ...parseArgv(["serve", "--super-agent", "--mock", "--no-exec", "--quiet", "--port", "0", "--no-open"]),
    cwd,
  };
  assert.equal(flags.superAgent, true);
  const serve = await startServe(flags, { homeDir: home });
  const base = serve.url.replace(/\?.*$/, "");
  const token = new URL(serve.url).searchParams.get("token") ?? "";
  try {
    const signed = await client(base).post("/api/auth", { token });
    assert.equal(signed.status, 204);
    const cookie = String(signed.headers["set-cookie"]).split(";")[0] ?? "";
    const api = client(base, cookie);
    const info = JSON.parse((await api.get("/api/info")).body) as {
      superAgentPanel?: true;
      superAgentChat?: true;
    };
    assert.equal(info.superAgentPanel, true);
    assert.equal(info.superAgentChat, true);

    const tab = stream(base, cookie);
    await tab.until("session");
    assert.equal((await api.post("/api/send", { text: "修登录空指针" })).status, 202);
    const turn = await tab.until("turn.end");
    const types = turn.map((e) => e.type);
    assert.ok(types.includes("user"), `expected user, got ${types.join(",")}`);
    assert.ok(types.includes("text"), `expected text, got ${types.join(",")}`);
    const text = turn
      .filter((e): e is Extract<HostEvent, { type: "text" }> => e.type === "text")
      .map((e) => e.delta)
      .join("");
    assert.match(text, /DONE|已处理|needs_human/);

    const panelPath = path.join(cwd, ".tah", "super-agent", "panel.json");
    assert.ok(existsSync(panelPath), "panel.json missing");
    const panel = JSON.parse(readFileSync(panelPath, "utf8")) as { agentId: string };
    assert.ok(panel.agentId);

    const snap = JSON.parse((await api.get("/api/super-agent/panel")).body) as { agentId: string };
    assert.equal(snap.agentId, panel.agentId);
    tab.close();
  } finally {
    await serve.stop();
  }
});

function stubHost(sessionId = "s1"): ChatHost {
  const listeners = new Set<(e: HostEvent) => void>();
  return {
    sessionId,
    approve: true,
    permissionMode: "manual",
    setPermissionMode() {},
    browser: undefined,
    skills: [],
    slashPrompts: [],
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async open() {},
    snapshot: () => ({ type: "session", id: sessionId, history: [], state: "idle", cwd: "", mode: "manual", model: "", approve: true, skills: [], resumed: false }),
    saveAttachment: () => {
      throw new Error("no");
    },
    async send() {},
    async sendQueued() {},
    removeQueued() {},
    async continueTurn() {},
    async compact() {},
    cancel() {},
    answer() {},
    answerQuestion() {},
    skipQuestion() {},
    async reset() {},
    async resume() {},
    async fork() {},
    async listSessions() {
      return [];
    },
    async renameSession() {
      return undefined;
    },
    async setSessionFlag() {},
    async reload() {},
    async close() {},
  } as ChatHost;
}

test("super-agent bridge: web turn mirrors to IM peer", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sa-bridge-"));
  const im = createMockChannel({ name: "telegram" });
  const chat = await createSuperAgentChat({
    cwd,
    persistDir: ".tah/super-agent",
    mockLlm: true,
    skipConfigChannels: true,
    extraAdapters: [im],
  });
  try {
    const host = chat.wrap(stubHost());
    const events: HostEvent[] = [];
    host.on((e) => events.push(e));

    im.push({
      source: "telegram",
      threadId: "tg:chat/1",
      text: "ping",
      isNewThread: true,
      replyTo: { kind: "telegram", chatId: 1 },
    });
    for (let i = 0; i < 80; i += 1) {
      if (im.sent.length > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(im.sent.length >= 1, "expected TG reply to ping");
    const before = im.sent.length;

    await host.send("hello from web");
    assert.ok(
      im.sent.slice(before).some((s) => s.text.includes("hello from web")),
      `expected mirrored user text, got ${im.sent.slice(before).map((s) => s.text).join(" | ")}`,
    );
    assert.ok(
      im.sent.slice(before).some((s) => /DONE|已处理|needs_human|hello/i.test(s.text)),
      "expected mirrored assistant reply on IM",
    );
    assert.ok(events.some((e) => e.type === "user" && e.text === "hello from web"));
    assert.ok(events.some((e) => e.type === "turn.end"));
  } finally {
    await chat.stop();
  }
});

test("super-agent reload: IM peer works after reload()", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-sa-reload-"));
  const im = createMockChannel({ name: "telegram" });
  const chat = await createSuperAgentChat({
    cwd,
    persistDir: ".tah/super-agent",
    mockLlm: true,
    skipConfigChannels: true,
    extraAdapters: [im],
  });
  try {
    const host = chat.wrap(stubHost("s-reload"));
    await chat.reload();
    // After reload, extraAdapters are started again (new mock instance is NOT recreated —
    // same `im` reference is in extras). Re-seed peer via push.
    im.push({
      source: "telegram",
      threadId: "tg:chat/9",
      text: "again",
      isNewThread: true,
      replyTo: { kind: "telegram", chatId: 9 },
    });
    for (let i = 0; i < 80; i += 1) {
      if (im.sent.length > 0) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(im.sent.length >= 1, "expected reply after reload");
    const before = im.sent.length;
    await host.send("web after reload");
    assert.ok(
      im.sent.slice(before).some((s) => s.text.includes("web after reload")),
      `mirror after reload failed: ${im.sent.slice(before).map((s) => s.text).join(" | ")}`,
    );
  } finally {
    await chat.stop();
  }
});
