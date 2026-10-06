import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import { bootRuntime } from "../dist/runtime.js";

const pingServer = fileURLToPath(
  new URL("../../mcp/test/fixtures/ping-server.mjs", import.meta.url),
);

test("parseArgv defaults mcp off and accepts --mcp / --mcp-arg", () => {
  assert.equal(parseArgv(["run", "hi"]).mcpCommand, "");
  assert.deepEqual(parseArgv(["run", "hi"]).mcpArgs, []);
  const on = parseArgv(["--mcp", "node", "--mcp-arg", pingServer, "run", "hi"]);
  assert.equal(on.mcpCommand, "node");
  assert.deepEqual(on.mcpArgs, [pingServer]);
});

test("bootRuntime mounts stdio MCP tools only with --mcp", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-cli-mcp-"));
  const base = {
    command: "run",
    prompt: "",
    cwd,
    mock: true,
    persist: false,
    quiet: true,
    exec: false,
    mcpCommand: "",
    mcpArgs: [] as string[],
    allow: [] as string[],
    deny: [] as string[],
    onceMs: -1,
  };

  const off = await bootRuntime(base);
  assert.equal(
    off.runtime.get(TOOLS).listSchemas().some((t) => t.name === "ping"),
    false,
  );
  await off.runtime.stop();

  const on = await bootRuntime({
    ...base,
    mcpCommand: process.execPath,
    mcpArgs: [pingServer],
  });
  assert.equal(
    on.runtime.get(TOOLS).listSchemas().some((t) => t.name === "ping"),
    true,
  );
  await on.runtime.stop();
});
