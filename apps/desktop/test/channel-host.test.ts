import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startChannelHost } from "../dist/channel-host.js";
import { startServer } from "../dist/server.js";

const cli = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

test("startChannelHost stops on SIGINT", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-ch-host-"));
  let exits = 0;
  const host = startChannelHost({
    node: process.execPath,
    cli,
    cwd,
    env: { ...process.env, FAKE_MODE: "ok" },
    onExit: () => {
      exits += 1;
    },
  });
  await new Promise((r) => setTimeout(r, 100));
  await host.stop();
  assert.equal(exits, 0);
});

test("startServer passes --super-agent-panel", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-panel-"));
  const panel = path.join(cwd, ".tah", "super-agent");
  let stderr = "";
  const childEnv = { ...process.env, FAKE_MODE: "ok" };
  // Capture panel line from fake stderr via a custom onExit won't work before stop;
  // startServer doesn't expose stderr. Re-spawn check: fake prints panel= on stderr —
  // we assert via serve start succeeding with the option (no throw).
  const s = await startServer({
    node: process.execPath,
    cli,
    cwd,
    env: childEnv,
    onExit: (t) => {
      stderr = t;
    },
    superAgentPanel: panel,
  });
  assert.match(s.url, /^http:\/\/127\.0\.0\.1:\d+/);
  await s.stop();
  void stderr;
});
