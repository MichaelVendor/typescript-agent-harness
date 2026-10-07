import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PERMISSIONS } from "@typescript-agent-harness/permissions";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import { bootRuntime } from "../dist/runtime.js";

test("parseArgv defaults exec on; --no-exec turns it off", () => {
  assert.equal(parseArgv(["run", "hi"]).exec, true);
  assert.equal(parseArgv(["--no-exec", "run", "hi"]).exec, false);
  assert.equal(parseArgv(["--exec", "run", "hi"]).exec, true);
});

test("bootRuntime mounts execute_command by default; --no-exec hides it", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-cli-"));
  const base = {
    command: "run",
    prompt: "",
    cwd,
    mock: true,
    persist: false,
    quiet: true,
    mcpCommand: "",
    mcpArgs: [] as string[],
    allow: [] as string[],
    deny: [] as string[],
    onceMs: -1,
    maxSteps: 32,
  };

  const on = await bootRuntime({ ...base, exec: true });
  assert.equal(
    on.runtime.get(TOOLS).listSchemas().some((t) => t.name === "execute_command"),
    true,
  );
  assert.ok(on.runtime.context().tryGet(PERMISSIONS));
  await on.runtime.stop();

  const off = await bootRuntime({ ...base, exec: false });
  const offNames = off.runtime.get(TOOLS).listSchemas().map((t) => t.name);
  assert.equal(offNames.includes("execute_command"), false);
  assert.equal(offNames.includes("grep"), true);
  await off.runtime.stop();
});
