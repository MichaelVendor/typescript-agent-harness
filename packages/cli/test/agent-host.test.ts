import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { ServerResponse } from "node:http";
import { parseArgv } from "../dist/args.js";
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
    const res = await fetch(`${url}/v1/sessions`);
    assert.equal(res.status, 404);
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
