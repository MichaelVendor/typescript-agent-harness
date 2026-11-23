import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseArgv } from "../dist/args.js";
import { startAgentWorker } from "../dist/agent-worker/run.js";

const TOKEN = "worker-test-token";

function mockFlags(cwd: string) {
  return {
    ...parseArgv(["--mock", "--persist", "--quiet", "--yes", "--no-exec", "--no-watch", "--port", "0", "agent-worker"]),
    cwd,
  };
}

async function boot() {
  const tmp = await mkdtemp(path.join(tmpdir(), "tah-agent-worker-"));
  const home = await mkdtemp(path.join(tmpdir(), "tah-agent-worker-home-"));
  return startAgentWorker({ token: TOKEN, flags: mockFlags(tmp), homeDir: home });
}

const auth = { Authorization: `Bearer ${TOKEN}` };
const jsonHeaders = { ...auth, "content-type": "application/json" };

type SseEvent = { type: string; text?: string; delta?: string };

function readSse(res: Response) {
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
  assert.ok(res.body);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const events: SseEvent[] = [];
  return {
    events,
    async until(pred: (events: SseEvent[]) => boolean) {
      while (!pred(events)) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let at = buf.indexOf("\n\n");
        while (at !== -1) {
          const line = buf.slice(0, at).split("\n").find((l) => l.startsWith("data: "));
          buf = buf.slice(at + 2);
          if (line) events.push(JSON.parse(line.slice("data: ".length)) as SseEvent);
          at = buf.indexOf("\n\n");
        }
      }
      return events;
    },
    close: () => reader.cancel().catch(() => {}),
  };
}

test("GET /health is public and binds 127.0.0.1", { timeout: 20_000 }, async () => {
  const { url, stop } = await boot();
  try {
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+$/);
    const res = await fetch(`${url}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    await stop();
  }
});

test("routes other than /health need the Bearer token", { timeout: 20_000 }, async () => {
  const { url, stop } = await boot();
  try {
    assert.equal((await fetch(`${url}/events`)).status, 401);
    assert.equal((await fetch(`${url}/session`)).status, 401);
    assert.equal((await fetch(`${url}/events`, { headers: { Authorization: "Bearer nope" } })).status, 401);
    for (const route of ["send", "cancel", "answer", "question", "continue", "compact", "queue"]) {
      const res = await fetch(`${url}/${route}`, { method: "POST", body: "{}" });
      assert.equal(res.status, 401, route);
    }
    assert.equal((await fetch(`${url}/nope`, { headers: auth })).status, 404);
  } finally {
    await stop();
  }
});

test("GET /session returns host snapshot with session id", { timeout: 20_000 }, async () => {
  const { url, stop, host } = await boot();
  try {
    const res = await fetch(`${url}/session`, { headers: auth });
    assert.equal(res.status, 200);
    const snap = (await res.json()) as { type: string; id: string };
    assert.equal(snap.type, "session");
    assert.equal(snap.id, host.sessionId);
    assert.ok(snap.id.length > 0);
  } finally {
    await stop();
  }
});

test("POST /send streams user/text/turn.end over GET /events", { timeout: 20_000 }, async () => {
  const { url, stop, host } = await boot();
  try {
    const sse = readSse(await fetch(`${url}/events`, { headers: auth }));
    const empty = await fetch(`${url}/send`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "  " }) });
    assert.equal(empty.status, 400);

    const sent = await fetch(`${url}/send`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ text: "hello" }) });
    assert.equal(sent.status, 202);
    const events = await sse.until((all) => all.some((e) => e.type === "turn.end"));
    const types = events.map((e) => e.type);
    const userAt = types.indexOf("user");
    const textAt = types.indexOf("text");
    const endAt = types.indexOf("turn.end");
    assert.ok(userAt >= 0 && textAt > userAt && endAt > textAt, types.join(","));
    assert.equal(events[userAt]?.text, "hello");
    assert.equal(typeof host.sessionId, "string");
    await sse.close();
  } finally {
    await stop();
  }
});

test("POST /send while busy queues; cancel and bad bodies are validated", { timeout: 20_000 }, async () => {
  const { url, stop, host } = await boot();
  try {
    const sse = readSse(await fetch(`${url}/events`, { headers: auth }));
    const post = (route: string, body: unknown) =>
      fetch(`${url}${route}`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(body) });

    assert.equal((await post("/send", { text: "first" })).status, 202);
    assert.equal((await post("/send", { text: "second" })).status, 202);
    const events = await sse.until((all) => all.filter((e) => e.type === "turn.end").length >= 2);
    assert.deepEqual(
      events.filter((e) => e.type === "user").map((e) => e.text),
      ["first", "second"],
    );

    assert.equal((await post("/cancel", {})).status, 204);
    assert.equal((await post("/answer", { id: "x", answer: "maybe" })).status, 400);
    assert.equal((await post("/question", { id: "x", answers: "nope" })).status, 400);
    assert.equal((await post("/queue", { id: "x" })).status, 400);
    assert.equal((await post("/queue", { id: "x", remove: true })).status, 204);
    assert.equal(typeof host.sessionId, "string");
    await sse.close();
  } finally {
    await stop();
  }
});
