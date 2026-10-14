import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startServer, StartError } from "../dist/server.js";

const cli = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

function start(mode: string, extra: { onExit?: (stderr: string) => void; startTimeoutMs?: number; stopTimeoutMs?: number } = {}) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "tah-server-"));
  const server = startServer({
    node: process.execPath,
    cli,
    cwd,
    env: { ...process.env, FAKE_MODE: mode },
    onExit: extra.onExit ?? (() => {}),
    ...(extra.startTimeoutMs ? { startTimeoutMs: extra.startTimeoutMs } : {}),
    ...(extra.stopTimeoutMs ? { stopTimeoutMs: extra.stopTimeoutMs } : {}),
  });
  return { cwd, server };
}

test("reads the url, reports the active folder, stops on SIGINT", async () => {
  let exits = 0;
  const { cwd, server } = start("ok", { onExit: () => exits++ });
  const s = await server;
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+\/\?token=secret$/);
  assert.equal(await s.activeFolder(), cwd);
  await s.stop();
  assert.equal(await s.activeFolder(), undefined);
  assert.equal(exits, 0);
});

test("exiting before ready rejects with the stderr tail", async () => {
  await assert.rejects(start("exit").server, (err: unknown) => {
    assert.ok(err instanceof StartError);
    assert.match(err.message, /exited/);
    assert.match(err.stderr, /boom: no model configured/);
    return true;
  });
});

test("no url within the timeout rejects", async () => {
  await assert.rejects(start("hang", { startTimeoutMs: 300 }).server, /did not start/);
});

test("a missing node binary rejects", async () => {
  const server = startServer({ node: "/nonexistent/node", cli, cwd: os.tmpdir(), env: process.env, onExit: () => {} });
  await assert.rejects(server, StartError);
});

test("stop falls back to SIGKILL", async () => {
  const s = await start("stubborn", { stopTimeoutMs: 300 }).server;
  const started = Date.now();
  await s.stop();
  assert.ok(Date.now() - started < 3000);
  assert.equal(await s.activeFolder(), undefined);
});

test("an unexpected exit calls onExit with the stderr tail", async () => {
  const stderr = await new Promise<string>((resolve, reject) => {
    start("crash", { onExit: resolve }).server.catch(reject);
  });
  assert.match(stderr, /crashed hard/);
});
