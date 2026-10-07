import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PERMISSIONS } from "@typescript-agent-harness/permissions";
import { TOOLS } from "@typescript-agent-harness/tools";
import { parseArgv } from "../dist/args.js";
import { bootRuntime } from "../dist/runtime.js";

function baseFlags(cwd: string) {
  return {
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
    maxSteps: 32,
  };
}

test("parseArgv accepts repeatable --allow and --deny", () => {
  const off = parseArgv(["run", "hi"]);
  assert.deepEqual(off.allow, []);
  assert.deepEqual(off.deny, []);
  const on = parseArgv([
    "--allow",
    "list_files",
    "--allow",
    "read_file",
    "--deny",
    "write_file",
    "run",
    "hi",
  ]);
  assert.deepEqual(on.allow, ["list_files", "read_file"]);
  assert.deepEqual(on.deny, ["write_file"]);
});

test("bootRuntime --deny hides the tool; --allow is a whitelist", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-cli-perm-"));

  const denied = await bootRuntime({ ...baseFlags(cwd), deny: ["write_file"] });
  const deniedNames = denied.runtime.get(TOOLS).listSchemas().map((t) => t.name);
  assert.equal(deniedNames.includes("write_file"), false);
  assert.equal(deniedNames.includes("list_files"), true);
  assert.ok(denied.runtime.context().tryGet(PERMISSIONS));
  await denied.runtime.stop();

  const allowed = await bootRuntime({
    ...baseFlags(cwd),
    allow: ["list_files", "read_file"],
  });
  const allowedNames = allowed.runtime.get(TOOLS).listSchemas().map((t) => t.name);
  assert.deepEqual(allowedNames.sort(), ["list_files", "read_file"]);
  await allowed.runtime.stop();
});
