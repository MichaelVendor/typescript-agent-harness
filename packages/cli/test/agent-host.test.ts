import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ServerResponse } from "node:http";
import { parseArgv } from "../dist/args.js";
import { signAgentHostToken } from "../dist/agent-host/auth.js";
import { startAgentHost } from "../dist/agent-host/run.js";
import { writeHostEvent } from "../dist/agent-host/sse.js";
import type { HostEvent } from "../dist/host.js";

function mockFlags(cwd: string) {
  return { ...parseArgv(["--mock", "--persist", "--quiet", "--yes", "--no-exec", "--no-watch", "agent-host"]), cwd };
}

test("GET /health is public", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "tah-agent-host-"));
  const home = await mkdtemp(path.join(tmpdir(), "tah-agent-host-home-"));
  const { url, stop } = await startAgentHost({
    secret: "s",
    projectId: "p",
    host: "127.0.0.1",
    port: 0,
    flags: mockFlags(tmp),
    homeDir: home,
  });
  try {
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).projectId, "p");
  } finally {
    await stop();
  }
});

test("other routes are 404", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "tah-agent-host-"));
  const home = await mkdtemp(path.join(tmpdir(), "tah-agent-host-home-"));
  const { url, stop } = await startAgentHost({
    secret: "s",
    projectId: "p",
    host: "127.0.0.1",
    port: 0,
    flags: mockFlags(tmp),
    homeDir: home,
  });
  try {
    const token = signAgentHostToken("s", {
      projectId: "p",
      userId: "u1",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const res = await fetch(`${url}/v1/nope`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(res.status, 404);
  } finally {
    await stop();
  }
});

test("v1 routes need Bearer; list/create sessions", async () => {
  const tmp = await mkdtemp(path.join(tmpdir(), "tah-agent-host-"));
  const home = await mkdtemp(path.join(tmpdir(), "tah-agent-host-home-"));
  const { url, stop, host } = await startAgentHost({
    secret: "s",
    projectId: "p",
    host: "127.0.0.1",
    port: 0,
    flags: mockFlags(tmp),
    homeDir: home,
  });
  try {
    const noAuth = await fetch(`${url}/v1/sessions`);
    assert.equal(noAuth.status, 401);
    assert.equal(typeof (await noAuth.json()).error, "string");

    const token = signAgentHostToken("s", {
      projectId: "p",
      userId: "u1",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const headers = { Authorization: `Bearer ${token}` };

    const listed = await fetch(`${url}/v1/sessions`, { headers });
    assert.equal(listed.status, 200);
    assert.ok(Array.isArray(await listed.json()));

    const created = await fetch(`${url}/v1/sessions`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ title: "task-3" }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).sessionId, host.sessionId);

    const info = await fetch(`${url}/v1/info`, { headers });
    assert.equal(info.status, 200);
    const body = await info.json();
    assert.equal(body.approve, false);
    assert.equal(body.cwd, tmp);
    assert.equal(typeof body.version, "string");
    assert.ok(body.version.length > 0);

    const wrong = signAgentHostToken("s", {
      projectId: "other",
      userId: "u1",
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    const cross = await fetch(`${url}/v1/sessions`, { headers: { Authorization: `Bearer ${wrong}` } });
    assert.equal(cross.status, 401);
  } finally {
    await stop();
  }
});

test("writeHostEvent writes SSE data line", () => {
  const chunks: string[] = [];
  const res = { write: (chunk: string) => (chunks.push(chunk), true) };
  writeHostEvent(res as unknown as ServerResponse, { type: "text", delta: "hi" });
  assert.equal(chunks.join(""), `data: ${JSON.stringify({ type: "text", delta: "hi" })}\n\n`);
});

const PROJECT_PKG = JSON.stringify({
  type: "module",
  devDependencies: { "@typescript-agent-harness/cli": "*" },
});

type SseEvent = {
  type: string;
  text?: string;
  delta?: string;
  cancelled?: boolean;
  finishReason?: string;
};

function scaffoldProject(cwd: string, gateKey: string) {
  mkdirSync(path.join(cwd, "tools"), { recursive: true });
  writeFileSync(path.join(cwd, "package.json"), PROJECT_PKG);
  writeFileSync(
    path.join(cwd, "tools", "list-files.ts"),
    `export default {
  description: "list",
  inputSchema: { type: "object", properties: { directory: { type: "string" } } },
  async execute(_input, ctx) {
    const gate = globalThis[${JSON.stringify(gateKey)}];
    if (gate) {
      await new Promise((resolve, reject) => {
        gate.then(resolve, reject);
        const abort = () => reject(new Error("aborted"));
        if (ctx.signal.aborted) abort();
        else ctx.signal.addEventListener("abort", abort, { once: true });
      });
    }
    return { entries: [{ name: "a.txt", type: "file" }] };
  },
};
`,
  );
}

function bearer() {
  const token = signAgentHostToken("s", {
    projectId: "p",
    userId: "u1",
    exp: Math.floor(Date.now() / 1000) + 120,
  });
  return {
    Authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "text/event-stream",
  };
}

async function bootProject(gateKey: string) {
  const tmp = await mkdtemp(path.join(tmpdir(), "tah-agent-host-"));
  const home = await mkdtemp(path.join(tmpdir(), "tah-agent-host-home-"));
  scaffoldProject(tmp, gateKey);
  const started = await startAgentHost({
    secret: "s",
    projectId: "p",
    host: "127.0.0.1",
    port: 0,
    flags: mockFlags(tmp),
    homeDir: home,
  });
  return { ...started, headers: bearer() };
}

function createSse(res: Response) {
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.ok(res.body);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: SseEvent[] = [];
  const absorb = (chunk: string) => {
    buf += chunk;
    let splitAt = buf.indexOf("\n\n");
    while (splitAt !== -1) {
      const block = buf.slice(0, splitAt);
      buf = buf.slice(splitAt + 2);
      const line = block.split("\n").find((l) => l.startsWith("data: "));
      if (line) events.push(JSON.parse(line.slice("data: ".length)) as SseEvent);
      splitAt = buf.indexOf("\n\n");
    }
  };
  const readMore = async (): Promise<boolean> => {
    const { value, done } = await reader.read();
    if (done) {
      absorb(decoder.decode());
      if (buf.trim()) absorb("\n\n");
      return true;
    }
    absorb(decoder.decode(value, { stream: true }));
    return false;
  };
  return {
    events,
    async until(pred: (events: SseEvent[]) => boolean) {
      while (!pred(events)) {
        if (await readMore()) break;
      }
      return events;
    },
    async rest() {
      while (!(await readMore())) {
        /* drain until the response ends */
      }
      return events;
    },
  };
}

async function createSession(url: string, headers: Record<string, string>): Promise<string> {
  const created = await fetch(`${url}/v1/sessions`, { method: "POST", headers, body: "{}" });
  assert.equal(created.status, 201);
  const body = (await created.json()) as { sessionId: string };
  assert.equal(typeof body.sessionId, "string");
  return body.sessionId;
}

test("messages streams HostEvents then ends; cancel works; busy is 409", { timeout: 20_000 }, async () => {
  const gateKey = `tahGate_${Math.random().toString(36).slice(2)}`;
  const g = globalThis as Record<string, Promise<void> | undefined>;
  const { url, stop, host, headers } = await bootProject(gateKey);
  let release = () => {};
  try {
    const sessionId = await createSession(url, headers);
    const messages = `${url}/v1/sessions/${encodeURIComponent(sessionId)}/messages`;

    const empty = await fetch(messages, { method: "POST", headers, body: JSON.stringify({ text: "   " }) });
    assert.equal(empty.status, 400);
    assert.equal((await empty.json()).error, "message is empty");

    const ok = await fetch(messages, { method: "POST", headers, body: JSON.stringify({ text: "hello" }) });
    const done = await createSse(ok).rest();
    const types = done.map((event) => event.type);
    const userAt = types.indexOf("user");
    const textAt = types.indexOf("text");
    const endAt = types.lastIndexOf("turn.end");
    assert.ok(userAt >= 0 && textAt > userAt && endAt > textAt, types.join(","));
    assert.equal(types.at(-1), "turn.end");
    assert.equal(done[userAt]?.text, "hello");
    assert.equal(typeof done[textAt]?.delta, "string");
    assert.ok((done[textAt]?.delta ?? "").length > 0);
    assert.equal(done[endAt]?.finishReason, "stop");

    let resolveGate!: () => void;
    g[gateKey] = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    release = () => {
      resolveGate();
      delete g[gateKey];
    };

    // A later turn in the same session skips list_files (the mock already has its result), so hold a fresh session.
    const heldId = await createSession(url, headers);
    const heldMessages = `${url}/v1/sessions/${encodeURIComponent(heldId)}/messages`;
    const pending = await fetch(heldMessages, { method: "POST", headers, body: JSON.stringify({ text: "hold" }) });
    const held = createSse(pending);
    await held.until((events) => events.some((event) => event.type === "tool.start"));
    assert.equal(held.events.some((event) => event.type === "turn.end" || event.type === "turn.error"), false);

    const again = await fetch(heldMessages, { method: "POST", headers, body: JSON.stringify({ text: "second" }) });
    assert.equal(again.status, 409);
    assert.deepEqual(await again.json(), { error: "turn_in_progress" });

    const cancel = await fetch(`${url}/v1/sessions/${encodeURIComponent(heldId)}/cancel`, {
      method: "POST",
      headers,
    });
    assert.equal(cancel.status, 204);
    assert.equal(await cancel.text(), "");

    const cancelled = await held.rest();
    assert.equal(cancelled.filter((event) => event.type === "user").length, 1);
    assert.equal(cancelled.at(-1)?.type, "turn.error");
    assert.equal(cancelled.at(-1)?.cancelled, true);

    g[gateKey] = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    const dropId = await createSession(url, headers);
    const ctrl = new AbortController();
    const dropping = await fetch(`${url}/v1/sessions/${encodeURIComponent(dropId)}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "drop" }),
      signal: ctrl.signal,
    });
    const droppingSse = createSse(dropping);
    await droppingSse.until((events) => events.some((event) => event.type === "tool.start"));
    const outcome = new Promise<HostEvent>((resolve, reject) => {
      let off = () => {};
      const timer = setTimeout(() => {
        off();
        reject(new Error("disconnect did not end the turn"));
      }, 5_000);
      off = host.on((event) => {
        if (event.type === "turn.error" || event.type === "turn.end") {
          clearTimeout(timer);
          off();
          resolve(event);
        }
      });
    });
    ctrl.abort();
    const ended = await outcome;
    assert.equal(ended.type, "turn.error");
    assert.equal(ended.type === "turn.error" && ended.cancelled, true);
    await droppingSse.rest().catch(() => {});
  } finally {
    release();
    host.cancel();
    await stop();
  }
});

test("messages resume another session; a busy turn is 409 before resume", { timeout: 20_000 }, async () => {
  const gateKey = `tahGate_${Math.random().toString(36).slice(2)}`;
  const g = globalThis as Record<string, Promise<void> | undefined>;
  const { url, stop, host, headers } = await bootProject(gateKey);
  let release = () => {};
  try {
    const first = await createSession(url, headers);
    const second = await createSession(url, headers);
    assert.equal(host.sessionId, second);

    let resolveGate!: () => void;
    g[gateKey] = new Promise<void>((resolve) => {
      resolveGate = resolve;
    });
    release = () => {
      resolveGate();
      delete g[gateKey];
    };

    const pending = await fetch(`${url}/v1/sessions/${encodeURIComponent(second)}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "hold" }),
    });
    const held = createSse(pending);
    await held.until((events) => events.some((event) => event.type === "user"));

    const cross = await fetch(`${url}/v1/sessions/${encodeURIComponent(first)}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "switch" }),
    });
    assert.equal(cross.status, 409);
    assert.deepEqual(await cross.json(), { error: "turn_in_progress" });
    assert.equal(host.sessionId, second);

    const cancelOther = await fetch(`${url}/v1/sessions/${encodeURIComponent(first)}/cancel`, {
      method: "POST",
      headers,
    });
    assert.equal(cancelOther.status, 409);
    assert.deepEqual(await cancelOther.json(), { error: "turn_in_progress" });
    assert.equal(host.sessionId, second);

    release();
    release = () => {};
    const finished = await held.rest();
    assert.equal(finished.at(-1)?.type, "turn.end");
    assert.equal(host.sessionId, second);

    const resumed = await fetch(`${url}/v1/sessions/${encodeURIComponent(first)}/messages`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: "back" }),
    });
    const events = await createSse(resumed).rest();
    assert.equal(events.find((event) => event.type === "user")?.text, "back");
    assert.equal(events.at(-1)?.type, "turn.end");
    assert.equal(host.sessionId, first);
    assert.equal(host.snapshot().id, first);
  } finally {
    release();
    host.cancel();
    await stop();
  }
});
