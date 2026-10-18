import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ServerResponse } from "node:http";
import { parseArgv } from "../dist/args.js";
import { signAgentHostToken } from "../dist/agent-host/auth.js";
import { startAgentHost } from "../dist/agent-host/run.js";
import { writeHostEvent } from "../dist/agent-host/sse.js";

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
