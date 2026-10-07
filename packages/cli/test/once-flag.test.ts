import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { SCHEDULER } from "@typescript-agent-harness/scheduler";
import { parseArgv } from "../dist/args.js";
import { bootRuntime, runPrompt } from "../dist/runtime.js";

function baseFlags(cwd: string) {
  return {
    command: "run",
    prompt: "hi",
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

test("parseArgv defaults --once off and accepts a delay", () => {
  assert.equal(parseArgv(["run", "hi"]).onceMs, -1);
  assert.equal(parseArgv(["--once", "50", "run", "hi"]).onceMs, 50);
  assert.throws(() => parseArgv(["--once", "nope", "run", "hi"]), /non-negative integer/);
});

test("bootRuntime mounts scheduler only with --once", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-cli-once-"));
  const off = await bootRuntime(baseFlags(cwd));
  assert.equal(off.runtime.context().tryGet(SCHEDULER), undefined);
  await off.runtime.stop();

  const on = await bootRuntime({ ...baseFlags(cwd), onceMs: 20 });
  assert.ok(on.runtime.context().tryGet(SCHEDULER));
  await on.runtime.stop();
});

test("runPrompt --once fires a session after the delay", async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), "tah-cli-once-run-"));
  const flags = { ...baseFlags(cwd), onceMs: 20 };
  const { runtime, streamed } = await bootRuntime(flags);
  const started = Date.now();
  const ended: string[] = [];
  runtime.on("scheduler.job.end", (e) => {
    ended.push((e as { jobId: string }).jobId);
  });
  try {
    await runPrompt(runtime, flags, streamed);
    assert.ok(Date.now() - started >= 15);
    assert.deepEqual(ended, ["tah-run"]);
  } finally {
    await runtime.stop();
  }
});
