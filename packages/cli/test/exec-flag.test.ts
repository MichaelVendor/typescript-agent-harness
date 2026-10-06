import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PERMISSIONS } from "@typescript-agent-harness/permissions";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import { bootRuntime } from "../dist/runtime.js";

test("parseArgv defaults exec off and accepts --exec", () => {
  assert.equal(parseArgv(["run", "hi"]).exec, false);
  assert.equal(parseArgv(["--exec", "run", "hi"]).exec, true);
});

test("bootRuntime mounts execute_command only with --exec", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-cli-"));
  const base = {
    command: "run",
    prompt: "",
    cwd,
    mock: true,
    persist: false,
    quiet: true,
    mcpCommand: "",
    mcpArgs: [],
    allow: [],
    deny: [],
    onceMs: -1,
  };

  const off = await bootRuntime({ ...base, exec: false });
  const offNames = off.runtime.get(TOOLS).listSchemas().map((t) => t.name);
  assert.equal(offNames.includes("execute_command"), false);
  assert.equal(offNames.includes("grep"), true);
  assert.equal(off.runtime.context().tryGet(PERMISSIONS), undefined);
  await off.runtime.stop();

  const on = await bootRuntime({ ...base, exec: true });
  assert.equal(
    on.runtime.get(TOOLS).listSchemas().some((t) => t.name === "execute_command"),
    true,
  );
  assert.ok(on.runtime.context().tryGet(PERMISSIONS));
  await on.runtime.stop();
});
